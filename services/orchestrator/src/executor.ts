import type {
  IssueRecord,
  QualityGateResult,
  RepairResult,
  RunRecord,
  TestResult,
  VerificationDecision,
} from "@ads/shared-types";
import { DEFAULT_BUDGET, isTerminal } from "@ads/shared-types";
import { IssueLedger } from "@ads/issue-ledger";
import { evaluateQualityGates, gatesPassed } from "@ads/policy-engine";
import { advance, measureProgress, type EngineContext, type StepSignals } from "@ads/workflow-engine";
import { analyzeMissingTests, runCodeReview, runSecurityReview } from "./analyzers";
import type { ExecutorHost, FileMap, RunEventSink } from "./ports";
import { attemptDeterministicRepair, buildRepairGoal, repairBranchName } from "./repair";
import { verifyRepair } from "./verification";


export interface SessionRepair {
  issue: IssueRecord;
  repair: RepairResult;
  applied: boolean;
  reason?: string;
}

export interface RunSession {
  run: RunRecord;
  ledger: IssueLedger;
  files: FileMap;
  repairs: SessionRepair[];
  targetedTests: TestResult[];
  regressionTests: TestResult[];
  verifications: VerificationDecision[];
  gates: QualityGateResult[];
  securityScanPassed?: boolean;
  /** Issues snapshot at iteration start, for progress measurement. */
  iterationSnapshot: IssueRecord[];
  changedPaths: string[];
  aiTasks: Array<{ issueId: string; goal: string; status: "pending" | "dispatched" | "unavailable" }>;
}

export interface ExecutorDeps {
  host: ExecutorHost;
  events: RunEventSink;
  /** Optional GitLab Duo flow dispatch (Agent Platform). */
  dispatchFlow?: (goal: string, clientReference: string) => Promise<{ workflowId: number }>;
  duoEnabled?: boolean;
}

export function engineContextOf(session: RunSession, nowMs = Date.now()): EngineContext {
  return {
    state: session.run.state,
    iteration: session.run.iteration,
    budget: session.run.budget ?? DEFAULT_BUDGET,
    startedAtMs: Date.parse(session.run.startedAt ?? session.run.createdAt),
    nowMs,
    tokensUsed: session.run.tokensUsed,
    noProgressIterations: session.run.noProgressIterations,
    failureFingerprints: session.run.failureFingerprints,
    cancelled: session.run.state === "CANCELLED" || (session.run as { cancelRequested?: boolean }).cancelRequested === true,
  };
}
/** Execute the work for the run's CURRENT state, then advance the machine. */
export async function executeStep(session: RunSession, deps: ExecutorDeps): Promise<RunSession> {
  const { run, ledger } = session;
  const emit = (type: string, payload: Record<string, unknown>) =>
    deps.events.emit(run.id, type, payload);

  if (isTerminal(run.state)) return session;

  let signals: StepSignals | undefined;

  switch (run.state) {
    case "INITIALIZED": {
      run.startedAt = run.startedAt ?? new Date().toISOString();
      signals = { ok: true };
      break;
    }

    case "CHECKOUT": {
      const res = await deps.host.checkout(run.id, run.ref, run.commitSha);
      if (res.ok) {
        session.files = res.files;
        session.changedPaths = Object.keys(res.files);
        run.commitSha = res.commitSha;
        emit("log", { message: `Checked out ${res.commitSha} (${Object.keys(res.files).length} files)` });
      } else {
        emit("error", { message: res.detail ?? "Checkout failed" });
      }
      signals = { ok: res.ok, failureFingerprint: "checkout_failed", detail: res.detail };
      break;
    }

    case "ANALYSIS": {
      const codeFindings = runCodeReview(run.id, run.commitSha, session.files);
      const secFindings = runSecurityReview(run.id, run.commitSha, session.files);
      const missingTests = analyzeMissingTests(run.id, run.commitSha, session.files, session.changedPaths);
      let newCount = 0;
      for (const f of [...codeFindings, ...secFindings, ...missingTests]) {
        const { created } = ledger.addFinding(f.input);
        if (created) {
          newCount++;
          emit("issue_found", { rule: f.ruleId, file: f.filePath, line: f.line });
        }
      }
      emit("log", {
        message: `Analysis: ${newCount} new finding(s) (code=${codeFindings.length}, security=${secFindings.length}, missing-tests=${missingTests.length})`,
      });
      signals = { ok: true };
      break;
    }
    case "ISSUE_TRIAGE": {
      session.iterationSnapshot = ledger.snapshot();
      for (const issue of ledger.list()) {
        if (issue.state === "open" || issue.state === "reopened") {
          ledger.transition(issue.id, "triaged", "code-review", "Prioritized during triage");
          emit("issue_updated", { issueId: issue.id, state: "triaged" });
        }
      }
      signals = { ok: true };
      break;
    }

    case "REPAIR_PLANNING": {
      const targets = ledger
        .list()
        .filter((i) => i.state === "triaged")
        .sort((a, b) => Number(b.blocksRelease) - Number(a.blocksRelease));
      session.repairs = [];
      session.aiTasks = [];
      let planned = 0;
      for (const issue of targets) {
        const attempt = attemptDeterministicRepair(issue, session.files, run.id, run.iteration);
        if (attempt) {
          ledger.transition(issue.id, "repair_planned", "repair", `Planned deterministic fix (${attempt.result.branch})`);
          session.repairs.push({ issue, repair: attempt.result, applied: false });
          planned++;
        } else if (deps.duoEnabled && deps.dispatchFlow) {
          ledger.transition(issue.id, "repair_planned", "repair", "Planned AI (GitLab Duo flow) repair");
          session.aiTasks.push({ issueId: issue.id, goal: buildRepairGoal(issue), status: "pending" });
          planned++;
        } else {
          ledger.transition(
            issue.id,
            "blocked",
            "repair",
            "No deterministic transform available and Duo flows disabled — needs AI or human repair",
          );
          emit("issue_updated", { issueId: issue.id, state: "blocked", reason: "no_repair_path" });
        }
      }
      emit("log", { message: `Repair plan: ${planned} task(s) planned for iteration ${run.iteration}` });
      signals = { ok: true };
      break;
    }
    case "PATCH_GENERATION": {
      let tokens = 0;
      const budget = run.budget;
      for (const task of session.aiTasks) {
        if (task.status !== "pending" || !deps.dispatchFlow) continue;
        try {
          await deps.dispatchFlow(task.goal, `run:${run.id}:iter:${run.iteration}:${task.issueId}`);
          task.status = "dispatched";
          tokens += 2000; // estimated consumption tracked against budget
        } catch (err) {
          task.status = "unavailable";
          emit("error", { message: `Duo flow dispatch failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
      for (const pr of session.repairs) {
        if (pr.applied) continue;
        if (pr.repair.patchSizeLines > budget.maxPatchSizeLines) {
          pr.reason = `Patch size ${pr.repair.patchSizeLines} exceeds budget ${budget.maxPatchSizeLines}`;
          ledger.transition(pr.issue.id, "blocked", "repair", pr.reason);
          emit("issue_updated", { issueId: pr.issue.id, state: "blocked", reason: "patch_too_large" });
          continue;
        }
        const attempt = attemptDeterministicRepair(pr.issue, session.files, run.id, run.iteration);
        if (!attempt) {
          pr.reason = "Deterministic transform no longer applies";
          continue;
        }
        for (const u of attempt.updates) session.files[u.path] = u.content;
        const commit = await deps.host.applyPatch(
          run.id,
          pr.repair.branch,
          attempt.updates,
          `fix(${pr.issue.category}): ${pr.issue.title} [autofix]`,
        );
        pr.applied = commit.ok;
        pr.repair.commitSha = commit.commitSha;
        if (commit.ok) {
          ledger.recordRepairAttempt(pr.issue.id);
          ledger.transition(pr.issue.id, "repair_attempted", "repair", `Patch applied on ${pr.repair.branch}`);
          emit("repair_generated", {
            issueId: pr.issue.id,
            branch: pr.repair.branch,
            patchSizeLines: pr.repair.patchSizeLines,
            commitSha: commit.commitSha,
          });
        } else {
          pr.reason = commit.detail ?? "Patch commit failed";
          emit("error", { message: pr.reason });
        }
      }
      if (tokens > 0) emit("log", { message: `AI execution budget consumed: +${tokens} tokens (est.)` });
      signals = { ok: true, tokensUsed: tokens };
      break;
    }

    case "TARGETED_TESTS": {
      const results = await deps.host.runTargetedTests(run.id, { commitSha: run.commitSha });
      session.targetedTests = results;
      for (const r of results) emit("test_result", { ...r });
      const ok = results.length > 0 && results.every((r) => r.passed);
      signals = {
        ok,
        failedRequirement: ok ? undefined : "targeted_tests",
        failureFingerprint: `targeted:${results.filter((r) => !r.passed).map((r) => r.suite).join(",") || "no_suites"}`,
      };
      break;
    }
    case "FULL_REGRESSION": {
      const results = await deps.host.runFullRegression(run.id, { commitSha: run.commitSha });
      session.regressionTests = results;
      for (const r of results) emit("test_result", { ...r });

      // Authoritative security rescan on the repaired tree.
      const secFindings = runSecurityReview(run.id, run.commitSha, session.files);
      const blockingSec = secFindings.filter((f) => f.input.blocksRelease);
      session.securityScanPassed = blockingSec.length === 0;
      emit("log", {
        message: `Security rescan: ${secFindings.length} finding(s), ${blockingSec.length} blocking`,
      });

      const testsOk = results.length > 0 && results.every((r) => r.passed);
      if (!session.securityScanPassed) {
        signals = { ok: false, failedRequirement: "security_scan", failureFingerprint: "security_scan_failed" };
      } else if (!testsOk) {
        signals = {
          ok: false,
          failedRequirement: "regression",
          failureFingerprint: `regression:${results.filter((r) => !r.passed).map((r) => r.suite).join(",") || "no_suites"}`,
        };
      } else {
        signals = { ok: true };
      }
      break;
    }

    case "INDEPENDENT_REVIEW": {
      const decisions: VerificationDecision[] = [];
      for (const pr of session.repairs.filter((p) => p.applied)) {
        const issue = ledger.get(pr.issue.id);
        if (issue.state === "repair_attempted") {
          ledger.transition(issue.id, "awaiting_verification", "repair", "Patch applied; awaiting independent verification");
        }
        const decision = verifyRepair({
          issue: ledger.get(pr.issue.id),
          repair: pr.repair,
          filesAfter: session.files,
          targetedTests: session.targetedTests,
          regressionTests: session.regressionTests,
          securityScanPassed: session.securityScanPassed,
        });
        decisions.push(decision);
        ledger.recordVerification(decision);
        emit("verification", { issueId: pr.issue.id, verdict: decision.verdict, confidence: decision.confidence });
      }
      // Repairs dispatched as AI tasks but unverified stay open (visible, never silently dropped).
      session.verifications = decisions;
      signals = { ok: true, verifications: decisions };
      break;
    }
    case "QUALITY_GATE": {
      const issues = ledger.list();
      const gates = evaluateQualityGates({
        issues,
        testResults: [...session.targetedTests, ...session.regressionTests],
        securityScanPassed: session.securityScanPassed,
      });
      session.gates = gates;
      for (const g of gates) emit("quality_gate", { ...g });

      const passed = gatesPassed(gates);
      const progress = measureProgress(session.iterationSnapshot, ledger.snapshot());
      if (!progress.progressMade) run.noProgressIterations += 1;
      else run.noProgressIterations = 0;

      const criticalViolation = gates.some(
        (g) => !g.passed && g.gate === "security_policy" && issues.some((i) => i.severity === "critical" && i.state !== "verified_fixed"),
      );
      signals = { ok: true, gatePassed: passed, criticalPolicyViolation: criticalViolation };
      break;
    }

    default:
      // NEXT_ITERATION / terminal states: pure transitions.
      signals = { ok: true };
      break;
  }

  const result = advance(engineContextOf(session), signals);
  applyResult(session, result, emit);
  return session;
}

function applyResult(
  session: RunSession,
  result: ReturnType<typeof advance>,
  emit?: (type: string, payload: Record<string, unknown>) => void,
): void {
  const { run, ledger } = session;
  for (const t of result.applied) {
    emit?.("state_changed", { from: t.from, to: t.to, reason: t.reason, iteration: run.iteration });
  }
  run.state = result.context.state;
  run.iteration = result.context.iteration;
  run.tokensUsed = result.context.tokensUsed;
  run.noProgressIterations = result.context.noProgressIterations;
  run.failureFingerprints = result.context.failureFingerprints;
  run.updatedAt = new Date().toISOString();
  if (result.stopReason) run.stopReason = result.stopReason;
  if (result.terminal) {
    run.finishedAt = run.finishedAt ?? new Date().toISOString();
    const metrics = ledger.metrics();
    emit?.("completed", {
      state: run.state,
      stopReason: run.stopReason,
      metrics: {
        verifiedFixes: metrics.verifiedFixes,
        remaining: metrics.remainingFindings,
        verifiedFixRate: metrics.verifiedFixRate,
        iterations: run.iteration,
      },
    });
  }
}





