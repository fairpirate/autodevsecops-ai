import { isTerminal } from "@ads/shared-types";
import type { EngineContext, StepSignals, TransitionResult } from "./types";
import { budgetExhausted, fail, finish, findRepeatedFailure, recordFailure } from "./helpers";

/**
 * Advance the run machine from its current state until it either needs new
 * external input (a step must be executed) or reaches a terminal state.
 *
 * Call with the signals of a completed step to transition onward; call without
 * signals to resolve the current position. Transitions repeat until stable.
 */
export function advance(ctx: EngineContext, signals?: StepSignals): TransitionResult {
  const applied: TransitionResult["applied"] = [];
  let cur: EngineContext = { ...ctx };
  const max = ctx.maxTransitions ?? 64;
  let guard = 0;

  const push = (to: EngineContext["state"], reason: string, extra?: Partial<EngineContext>) => {
    applied.push({ from: cur.state, to, reason });
    cur = { ...cur, ...extra, state: to };
  };

  let pending: StepSignals | undefined = signals;

  while (guard++ < max) {
    if (cur.cancelled) {
      if (!isTerminal(cur.state)) push("CANCELLED", "Cancellation requested by user");
      return finish(cur, applied, "cancelled_by_user");
    }

    const exhausted = budgetExhausted(cur);
    if (exhausted && !isTerminal(cur.state) && cur.state !== "INITIALIZED") {
      push("BLOCKED", "Execution budget exhausted (time or tokens)");
      return finish(cur, applied, exhausted);
    }

    const repeated = findRepeatedFailure(cur);
    if (repeated && !isTerminal(cur.state) && cur.state !== "INITIALIZED") {
      push("BLOCKED", "Same failure repeated beyond maxRepeatedFailures without new diagnosis");
      return finish(cur, applied, repeated);
    }

    if (!pending) break;
    if (isTerminal(cur.state)) break;
    const sig = pending;

    switch (cur.state) {
      case "INITIALIZED":
        push("CHECKOUT", "Run accepted, checking out source");
        pending = undefined;
        break;

      case "CHECKOUT":
        if (!sig.ok) return finish(fail(cur, sig), applied, undefined, "FAILED", "Checkout failed");
        push("ANALYSIS", "Checkout complete, analyzing commit");
        pending = undefined;
        break;

      case "ANALYSIS":
        if (!sig.ok) return finish(fail(cur, sig), applied, undefined, "FAILED", "Analysis failed");
        push("ISSUE_TRIAGE", "Analysis complete, triaging issues");
        pending = undefined;
        break;

      case "ISSUE_TRIAGE":
        if (!sig.ok) return finish(fail(cur, sig), applied, undefined, "FAILED", "Triage failed");
        push("REPAIR_PLANNING", "Issues prioritized, planning repairs");
        pending = undefined;
        break;

      case "REPAIR_PLANNING":
        if (sig.criticalPolicyViolation) {
          push("BLOCKED", "Critical policy violation detected during repair planning");
          return finish(cur, applied, "critical_policy_violation");
        }
        push("PATCH_GENERATION", "Repair plan ready, generating patches");
        pending = undefined;
        break;

      case "PATCH_GENERATION":
        if (sig.criticalPolicyViolation) {
          push("BLOCKED", "Critical policy violation detected in generated patch");
          return finish(cur, applied, "critical_policy_violation");
        }
        if (sig.tokensUsed) cur = { ...cur, tokensUsed: cur.tokensUsed + sig.tokensUsed };
        push("TARGETED_TESTS", "Patch generated, running targeted tests");
        pending = undefined;
        break;
      case "TARGETED_TESTS":
        if (!sig.ok) {
          cur = recordFailure(cur, sig.failureFingerprint ?? "targeted_tests_failed");
          if (sig.failedRequirement === "security_scan") {
            push("BLOCKED", "Security scan failed");
            return finish(cur, applied, "security_scan_failed");
          }
          if (sig.failedRequirement === "regression") {
            push("BLOCKED", "Mandatory regression requirement failed");
            return finish(cur, applied, "required_test_failed");
          }
          push("ISSUE_TRIAGE", "Targeted tests failed, re-triaging with new evidence");
          pending = undefined;
          break;
        }
        push("FULL_REGRESSION", "Targeted tests passed, running full regression");
        pending = undefined;
        break;

      case "FULL_REGRESSION":
        if (!sig.ok) {
          cur = recordFailure(cur, sig.failureFingerprint ?? "regression_failed");
          if (sig.failedRequirement === "security_scan") {
            push("BLOCKED", "Security scan failed during regression");
            return finish(cur, applied, "security_scan_failed");
          }
          push("ISSUE_TRIAGE", "Regression failed, re-triaging with new evidence");
          pending = undefined;
          break;
        }
        push("INDEPENDENT_REVIEW", "Regression passed, independent verification");
        pending = undefined;
        break;

      case "INDEPENDENT_REVIEW": {
        const min = cur.budget.minVerificationConfidence;
        const rejected = (sig.verifications ?? []).filter(
          (v) => v.verdict !== "verified_fixed" || v.confidence < min,
        );
        if (rejected.length > 0) {
          push(
            "ISSUE_TRIAGE",
            `${rejected.length} repair(s) rejected by independent verification; reopening issues`,
          );
          pending = undefined;
          break;
        }
        push("QUALITY_GATE", "All repairs verified, evaluating quality gates");
        pending = undefined;
        break;
      }

      case "QUALITY_GATE": {
        if (sig.criticalPolicyViolation) {
          push("BLOCKED", "Critical policy violation at quality gate");
          return finish(cur, applied, "critical_policy_violation");
        }
        if (sig.gatePassed) {
          push("READY_FOR_BUILD", "All mandatory quality gates passed");
          return finish(cur, applied, "all_mandatory_issues_fixed");
        }
        if (cur.iteration + 1 > cur.budget.maxIterations) {
          push("BLOCKED", "Maximum iterations reached without passing quality gates");
          return finish(cur, applied, "max_iterations");
        }
        if (cur.noProgressIterations >= 2) {
          push("BLOCKED", "No measurable progress over two iterations");
          return finish(cur, applied, "no_progress");
        }
        // Chain the zero-work NEXT_ITERATION transition directly into the next
        // iteration's triage; the counter is only reset when progress occurs.
        push("NEXT_ITERATION", "Quality gates not yet satisfied, starting next iteration");
        cur = { ...cur, iteration: cur.iteration + 1 };
        push("ISSUE_TRIAGE", `Iteration ${cur.iteration}: re-triaging unresolved issues`);
        pending = undefined;
        break;
      }

      case "NEXT_ITERATION":
        // Reached only when invoked directly; chain into triage.
        cur = { ...cur, iteration: cur.iteration + 1 };
        push("ISSUE_TRIAGE", `Iteration ${cur.iteration}: re-triaging unresolved issues`);
        pending = undefined;
        break;

    }
  }

  return { context: cur, applied, terminal: isTerminal(cur.state) };
}
