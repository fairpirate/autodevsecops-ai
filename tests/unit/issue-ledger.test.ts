import { describe, expect, it } from "vitest";
import { IssueLedger, LedgerError } from "@ads/issue-ledger";
import { decision, input } from "../fixtures/ledger-helpers";

describe("IssueLedger", () => {
  it("adds findings with a stable dedup key and merges overlapping findings", () => {
    const ledger = new IssueLedger("run1");
    const first = ledger.addFinding(input());
    const second = ledger.addFinding(
      input({ severity: "medium", evidence: [{ kind: "scanner", description: "second opinion" }] }),
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(ledger.list()).toHaveLength(1);
    expect(first.issue.severity).toBe("high");
    expect(first.issue.evidence).toHaveLength(2);
  });

  it("keeps different rules as separate issues", () => {
    const ledger = new IssueLedger("run1");
    ledger.addFinding(input());
    ledger.addFinding(input({ title: "AVS102: Debugger statement left in code" }));
    expect(ledger.list()).toHaveLength(2);
  });

  it("walks open -> triaged -> repair_planned -> repair_attempted -> awaiting -> verified_fixed", () => {
    const ledger = new IssueLedger("run1");
    const { issue } = ledger.addFinding(input());
    ledger.transition(issue.id, "triaged", "code-review", "prioritized");
    ledger.transition(issue.id, "repair_planned", "repair", "plan ready");
    ledger.recordRepairAttempt(issue.id);
    ledger.transition(issue.id, "awaiting_verification", "repair", "patch applied");
    ledger.recordVerification(decision(issue.id));
    expect(ledger.get(issue.id).state).toBe("verified_fixed");
    expect(ledger.get(issue.id).repairAttempts).toBe(1);
  });

  it("requires authorization + evidence for risk acceptance and false positives", () => {
    const ledger = new IssueLedger("run1");
    const { issue } = ledger.addFinding(input());
    ledger.transition(issue.id, "triaged", "code-review", "prioritized");
    expect(() => ledger.transition(issue.id, "accepted_risk", "human", "no auth")).toThrow(LedgerError);
    expect(() =>
      ledger.transition(issue.id, "accepted_risk", "human", "justification", { evidenceRef: "scan-1" }),
    ).toThrow(LedgerError);
    ledger.transition(issue.id, "accepted_risk", "human", "risk documented", {
      authorization: { actor: "alice", role: "admin", reason: "compensating control in place" },
      evidenceRef: "scan-1",
    });
    expect(ledger.get(issue.id).state).toBe("accepted_risk");
    expect(ledger.get(issue.id).history.at(-1)?.reason).toContain("alice");
  });

  it("rejects invalid transitions", () => {
    const ledger = new IssueLedger("run1");
    const { issue } = ledger.addFinding(input());
    expect(() => ledger.transition(issue.id, "verified_fixed", "verification", "skip")).toThrow(LedgerError);
  });

  it("reopens on rejected verification and counts regressions", () => {
    const ledger = new IssueLedger("run1");
    const { issue } = ledger.addFinding(input());
    ledger.transition(issue.id, "triaged", "code-review", "t");
    ledger.transition(issue.id, "repair_planned", "repair", "p");
    ledger.recordRepairAttempt(issue.id);
    ledger.transition(issue.id, "awaiting_verification", "repair", "a");
    ledger.recordVerification(decision(issue.id, { verdict: "rejected", rationale: "rule still matches" }));
    expect(ledger.get(issue.id).state).toBe("reopened");
    expect(ledger.metrics().newRegressions).toBe(1);
  });
});
