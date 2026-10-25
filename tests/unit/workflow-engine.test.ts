import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET } from "@ads/shared-types";
import { advance, measureProgress, stateIndex, type EngineContext } from "@ads/workflow-engine";

function ctx(over: Partial<EngineContext> = {}): EngineContext {
  return {
    state: "INITIALIZED",
    iteration: 1,
    budget: { ...DEFAULT_BUDGET },
    startedAtMs: 1_000_000,
    nowMs: 1_000_100,
    tokensUsed: 0,
    noProgressIterations: 0,
    failureFingerprints: {},
    ...over,
  };
}

const ok = { ok: true };

describe("workflow engine", () => {
  it("walks the happy path from INITIALIZED to READY_FOR_BUILD", () => {
    let c = ctx();
    const steps: Array<{ from: string; to: string }> = [];
    const drive = (signals: typeof ok) => {
      const r = advance(c, signals);
      c = r.context;
      for (const t of r.applied) steps.push({ from: t.from, to: t.to });
      return r;
    };

    drive(ok); // INITIALIZED -> CHECKOUT
    expect(c.state).toBe("CHECKOUT");
    drive(ok); // CHECKOUT -> ANALYSIS
    drive(ok); // ANALYSIS -> ISSUE_TRIAGE
    drive(ok); // ISSUE_TRIAGE -> REPAIR_PLANNING
    drive(ok); // REPAIR_PLANNING -> PATCH_GENERATION
    drive(ok); // PATCH_GENERATION -> TARGETED_TESTS
    drive(ok); // TARGETED_TESTS -> FULL_REGRESSION
    drive(ok); // FULL_REGRESSION -> INDEPENDENT_REVIEW
    const review = drive({ ok: true, verifications: [] });
    expect(c.state).toBe("QUALITY_GATE");
    const gate = drive({ ok: true, gatePassed: true });
    expect(c.state).toBe("READY_FOR_BUILD");
    expect(gate.terminal).toBe(true);
    expect(gate.stopReason).toBe("all_mandatory_issues_fixed");
    expect(steps[0]).toEqual({ from: "INITIALIZED", to: "CHECKOUT" });
  });

  it("loops back through NEXT_ITERATION when gates fail and budget allows", () => {
    let c = ctx({ state: "QUALITY_GATE" });
    const r = advance(c, { ok: true, gatePassed: false });
    c = r.context;
    expect(c.state).toBe("ISSUE_TRIAGE");
    expect(c.iteration).toBe(2);
    expect(r.applied.map((t) => t.to)).toEqual(["NEXT_ITERATION", "ISSUE_TRIAGE"]);
  });

  it("stops with max_iterations when the iteration budget is exhausted", () => {
    const c = ctx({ state: "QUALITY_GATE", iteration: DEFAULT_BUDGET.maxIterations });
    const r = advance(c, { ok: true, gatePassed: false });
    expect(r.context.state).toBe("BLOCKED");
    expect(r.stopReason).toBe("max_iterations");
  });

  it("stops with no_progress after two iterations without measurable progress", () => {
    const c = ctx({ state: "QUALITY_GATE", noProgressIterations: 2 });
    const r = advance(c, { ok: true, gatePassed: false });
    expect(r.context.state).toBe("BLOCKED");
    expect(r.stopReason).toBe("no_progress");
  });

  it("blocks when a required security scan fails", () => {
    const c = ctx({ state: "FULL_REGRESSION" });
    const r = advance(c, { ok: false, failedRequirement: "security_scan" });
    expect(r.context.state).toBe("BLOCKED");
    expect(r.stopReason).toBe("security_scan_failed");
  });

  it("blocks on repeated failure beyond the retry budget", () => {
    const c = ctx({
      failureFingerprints: { "regression:a": DEFAULT_BUDGET.maxRepeatedFailures + 1 },
    });
    const r = advance(c, ok);
    expect(r.context.state).toBe("BLOCKED");
    expect(r.stopReason).toBe("repeated_failure");
  });

  it("blocks when the runtime budget is exhausted", () => {
    const c = ctx({ nowMs: 1_000_000 + DEFAULT_BUDGET.maxRuntimeMs + 1 });
    const r = advance(c, ok);
    expect(r.context.state).toBe("BLOCKED");
    expect(r.stopReason).toBe("budget_exhausted");
  });

  it("cancels the run on demand", () => {
    const c = ctx({ state: "PATCH_GENERATION", cancelled: true });
    const r = advance(c, ok);
    expect(r.context.state).toBe("CANCELLED");
    expect(r.stopReason).toBe("cancelled_by_user");
  });

  it("rejects verifications below the confidence floor", () => {
    const c = ctx({ state: "INDEPENDENT_REVIEW" });
    const r = advance(c, {
      ok: true,
      verifications: [
        {
          issueId: "i1",
          verdict: "verified_fixed",
          confidence: 0.4,
          diffReviewed: true,
          testsReviewed: true,
          scannerOutputReviewed: true,
          originalIssueAddressed: true,
          regressionsIntroduced: [],
          evidence: [],
          rationale: "low confidence",
          reviewer: "independent-verification-agent",
          at: new Date().toISOString(),
        },
      ],
    });
    expect(r.context.state).toBe("ISSUE_TRIAGE"); // reopen instead of gate
  });

  it("blocks on critical policy violation at the gate", () => {
    const c = ctx({ state: "QUALITY_GATE" });
    const r = advance(c, { ok: true, gatePassed: false, criticalPolicyViolation: true });
    expect(r.context.state).toBe("BLOCKED");
    expect(r.stopReason).toBe("critical_policy_violation");
  });

  it("orders states consistently for the timeline UI", () => {
    expect(stateIndex("ANALYSIS")).toBeLessThan(stateIndex("QUALITY_GATE"));
    expect(stateIndex("NEXT_ITERATION")).toBe(stateIndex("QUALITY_GATE"));
  });
});

describe("measureProgress", () => {
  const issue = (id: string, state: any, blocks = true) =>
    ({ id, state, blocksRelease: blocks }) as any;

  it("detects newly resolved mandatory issues", () => {
    const before = [issue("a", "repair_attempted"), issue("b", "triaged")];
    const after = [issue("a", "verified_fixed"), issue("b", "triaged")];
    const p = measureProgress(before, after);
    expect(p.progressMade).toBe(true);
    expect(p.newlyFixed).toEqual(["a"]);
  });

  it("reports no progress when nothing changed", () => {
    const before = [issue("a", "repair_attempted")];
    const p = measureProgress(before, before.map((i) => ({ ...i })));
    expect(p.progressMade).toBe(false);
  });
});
