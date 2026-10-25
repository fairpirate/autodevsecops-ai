import { describe, expect, it } from "vitest";
import type { TestResult } from "@ads/shared-types";
import { Orchestrator, type ExecutorHost, type FileMap, type RunEventSink } from "@ads/orchestrator";

/** Fixture repo with deterministic, rule-detectable AND repairable defects. */
const FIXTURE: FileMap = {
  "src/app.ts": [
    "export function run() {",
    "  try {",
    "    doWork();",
    "  } catch (e) {}",
    "}",
    "export function debugFlag() {",
    "  debugger;",
    "}",
    "export const view = (html: string) => {",
    "  document.body.innerHTML = html;",
    "};",
    "export function digest(data: string) {",
    '  return createHash("md5").update(data).digest("hex");',
    "}",
  ].join("\n"),
  "src/app.test.ts": "test('placeholder', () => {});",
};

function fakeHost(over: Partial<ExecutorHost> = {}): ExecutorHost {
  const pass = (suite: string): TestResult => ({
    commitSha: "sha-fixture",
    environment: "local",
    suite,
    platform: "server",
    passed: true,
    durationMs: 5,
    total: 12,
    failed: 0,
    timestamp: new Date().toISOString(),
  });
  return {
    async checkout() {
      return { ok: true, files: { ...FIXTURE }, commitSha: "sha-fixture" };
    },
    async runTargetedTests() {
      return [pass("server:unit")];
    },
    async runFullRegression() {
      return [pass("server:unit"), pass("web:unit")];
    },
    async runSecurityScan() {
      return { passed: true, findings: [], tool: "fake" };
    },
    async applyPatch(_runId, _branch, files) {
      return { ok: true, commitSha: "sha-patch-1", detail: files.map((f) => f.path).join(",") };
    },
    ...over,
  };
}

function collector(): RunEventSink & { events: Array<{ type: string; payload: Record<string, unknown> }> } {
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  return {
    events,
    emit(_runId, type, payload) {
      events.push({ type, payload });
    },
  };
}

function makeOrchestrator(host = fakeHost(), sink = collector()) {
  const persisted: Array<{ state: string; issues: number }> = [];
  const orch = new Orchestrator({
    host,
    events: sink,
    persist: (run, issues) => {
      persisted.push({ state: run.state, issues: issues.length });
    },
  });
  return { orch, sink, persisted };
}

function createRun(orch: Orchestrator) {
  return orch.createRun({ projectId: "p1", gitlabProjectId: 1, ref: "main", commitSha: "sha-fixture" });
}

describe("closed-loop review & repair (end to end with fixtures)", () => {
  it("analyzes, repairs, verifies and passes the quality gate", async () => {
    const { orch, sink } = makeOrchestrator();
    const run = createRun(orch);
    const finished = await orch.run(run.id);

    expect(finished.state).toBe("READY_FOR_BUILD");
    expect(finished.stopReason).toBe("all_mandatory_issues_fixed");

    const session = orch.getSession(run.id)!;
    const issues = session.ledger.list();
    expect(issues.length).toBeGreaterThanOrEqual(4);
    const blocking = issues.filter((i) => i.blocksRelease);
    expect(blocking.length).toBeGreaterThan(0);
    for (const i of blocking) expect(i.state).toBe("verified_fixed");

    expect(session.files["src/app.ts"]).not.toContain("md5");
    expect(session.files["src/app.ts"]).not.toContain("catch (e) {}");
    expect(session.files["src/app.ts"]).not.toContain("debugger");
    expect(session.files["src/app.ts"]).toContain("textContent");

    const types = sink.events.map((e) => e.type);
    for (const t of ["state_changed", "issue_found", "repair_generated", "test_result", "verification", "quality_gate", "completed"]) {
      expect(types).toContain(t);
    }
  });

  it("produces independent verification evidence, not self-assessment", async () => {
    const { orch } = makeOrchestrator();
    const run = createRun(orch);
    await orch.run(run.id);
    const session = orch.getSession(run.id)!;
    const verified = session.ledger.list().filter((i) => i.state === "verified_fixed");
    expect(verified.length).toBeGreaterThan(0);
    for (const i of verified) {
      expect(i.verification?.reviewer).toBe("independent-verification-agent");
      expect(i.verification?.originalIssueAddressed).toBe(true);
      expect(i.verification?.evidence.length).toBeGreaterThan(0);
    }
  });
  it("keeps unfixable critical issues visible and blocks the run", async () => {
    const unfixable: FileMap = {
      "src/bad.ts": 'function parse(j: string) { return eval(j); }',
      "src/bad.test.ts": "test('x', () => {});",
    };
    const host = fakeHost({
      async checkout() {
        return { ok: true, files: { ...unfixable }, commitSha: "sha-bad" };
      },
    });
    const { orch } = makeOrchestrator(host);
    const run = createRun(orch);
    const finished = await orch.run(run.id, 100);

    const session = orch.getSession(run.id)!;
    const evalIssue = session.ledger.list().find((i) => i.title.includes("AVSS01"));
    expect(evalIssue).toBeDefined(); // never silently dropped
    expect(finished.state).toBe("BLOCKED");
    // The mandatory security rescan fails first (eval remains) — an authorized
    // early stop; either stop reason is correct evidence of enforcement.
    expect(finished.stopReason).toMatch(/security_scan_failed|critical_policy_violation/);
    expect(evalIssue!.state).toBe("blocked");
    expect(evalIssue!.history.some((h) => h.reason.includes("Duo flows disabled"))).toBe(true);
  });

  it("stops the loop when tests keep failing (repeated failure budget)", async () => {
    const failing = fakeHost({
      async runTargetedTests() {
        return [
          {
            commitSha: "sha-fixture",
            environment: "local",
            suite: "server:unit",
            platform: "server",
            passed: false,
            durationMs: 1,
            failureSummary: "always broken",
            timestamp: new Date().toISOString(),
          } satisfies TestResult,
        ];
      },
    });
    const { orch } = makeOrchestrator(failing);
    const run = createRun(orch);
    const finished = await orch.run(run.id, 100);
    expect(["BLOCKED", "FAILED"]).toContain(finished.state);
    expect(finished.stopReason).toMatch(
      /repeated_failure|no_progress|max_iterations|required_test_failed/,
    );
  });

  it("cancels on demand", async () => {
    const { orch } = makeOrchestrator();
    const run = createRun(orch);
    await orch.stepOnce(run.id);
    const cancelled = await orch.cancel(run.id);
    expect(cancelled.state).toBe("CANCELLED");
    expect(cancelled.stopReason).toBe("cancelled_by_user");
    expect(cancelled.finishedAt).toBeDefined();
  });

  it("persists state after every step", async () => {
    const { orch, persisted } = makeOrchestrator();
    const run = createRun(orch);
    await orch.run(run.id);
    expect(persisted.length).toBeGreaterThan(5);
    expect(persisted.at(-1)?.state).toBe("READY_FOR_BUILD");
  });
});

