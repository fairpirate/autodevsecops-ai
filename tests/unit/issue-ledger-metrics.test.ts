import { describe, expect, it } from "vitest";
import { IssueLedger } from "@ads/issue-ledger";
import { decision, input } from "../fixtures/ledger-helpers";

describe("IssueLedger metrics", () => {
  it("computes verified-fix rate with explicit exclusions", () => {
    const ledger = new IssueLedger("run1");
    const a = ledger.addFinding(input()).issue;
    const b = ledger.addFinding(input({ title: "AVS102: debugger" })).issue;
    ledger.addFinding(input({ title: "AVS201: missing test", blocksRelease: false }));

    ledger.transition(a.id, "triaged", "code-review", "t");
    ledger.transition(a.id, "repair_planned", "repair", "p");
    ledger.recordRepairAttempt(a.id);
    ledger.transition(a.id, "awaiting_verification", "repair", "a");
    ledger.recordVerification(decision(a.id));

    ledger.transition(b.id, "triaged", "code-review", "t");
    ledger.transition(b.id, "false_positive", "human", "fp", {
      authorization: { actor: "bob", role: "engineer", reason: "test fixture, not prod code" },
      evidenceRef: "review-1",
    });

    const m = ledger.metrics();
    expect(m.initialFindings).toBe(3);
    expect(m.verifiedFixes).toBe(1);
    expect(m.verifiedFixRateExclusions).toBe(1);
    expect(m.verifiedFixRateDenominator).toBe(2);
    expect(m.verifiedFixRate).toBeCloseTo(0.5);
    expect(m.remainingFindings).toBe(1);
  });

  it("hydrates from persisted records", () => {
    const ledger = new IssueLedger("run1");
    const { issue } = ledger.addFinding(input());
    const snapshot = ledger.snapshot();
    const fresh = new IssueLedger("run1");
    fresh.hydrate(snapshot);
    expect(fresh.get(issue.id).title).toBe(issue.title);
  });
});
