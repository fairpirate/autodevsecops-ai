import { createHash, randomUUID } from "node:crypto";
import type {
  IssueHistoryEntry,
  IssueRecord,
  IssueState,
  Severity,
  VerificationDecision,
} from "@ads/shared-types";

export interface NewIssueInput {
  runId: string;
  title: string;
  description: string;
  category: IssueRecord["category"];
  severity: Severity;
  confidence: number;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  evidence: IssueRecord["evidence"];
  impact: string;
  remediation: string;
  verificationMethod: string;
  blocksRelease: boolean;
  discoverySource: string;
  affectedRevision: string;
  regressionTestName?: string;
}

export type IssueActor = IssueHistoryEntry["actor"];

export interface Authorization {
  actor: string;
  role: "admin" | "engineer";
  reason: string;
}

export interface LedgerMetrics {
  initialFindings: number;
  remainingFindings: number;
  verifiedFixes: number;
  reopenedIssues: number;
  newRegressions: number;
  failedRepairAttempts: number;
  acceptedRisk: number;
  falsePositives: number;
  blocked: number;
  /**
   * verified-fix rate = independently verified fixed issues
   * divided by (initial findings - accepted risk - false positives).
   * Exclusions are explicit so the denominator is auditable.
   */
  verifiedFixRate: number;
  verifiedFixRateDenominator: number;
  verifiedFixRateExclusions: number;
}

/** Allowed state transitions. */
const TRANSITIONS: Record<IssueState, IssueState[]> = {
  open: ["triaged", "accepted_risk", "false_positive", "blocked"],
  triaged: ["repair_planned", "accepted_risk", "false_positive", "blocked"],
  repair_planned: ["repair_attempted", "blocked"],
  repair_attempted: ["awaiting_verification", "repair_planned", "blocked"],
  awaiting_verification: ["verified_fixed", "reopened", "blocked"],
  verified_fixed: ["reopened"],
  reopened: ["repair_planned", "triaged", "blocked", "accepted_risk", "false_positive"],
  accepted_risk: ["open"],
  false_positive: ["open"],
  blocked: ["triaged", "open"],
};

export const RESOLVED_STATES: IssueState[] = ["verified_fixed", "accepted_risk", "false_positive"];

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}
/**
 * Persistent, deduplicating ledger of findings for a run.
 * Storage is pluggable: in-memory for tests, Prisma-backed in production.
 */
export class IssueLedger {
  private issues = new Map<string, IssueRecord>();
  private regressions = 0;

  constructor(private readonly runId: string) {}

  /** Deterministic dedup key from source + location + normalized title. */
  static dedupKey(source: string, filePath: string | undefined, title: string): string {
    const norm = title.toLowerCase().replace(/\s+/g, " ").trim();
    return createHash("sha256").update(`${source}|${filePath ?? "-"}|${norm}`).digest("hex").slice(0, 32);
  }

  /**
   * Add a finding. Overlapping findings sharing rule+file+message fingerprint
   * are merged (evidence union, max severity/confidence).
   */
  addFinding(input: NewIssueInput): { issue: IssueRecord; created: boolean } {
    const dedupKey = IssueLedger.dedupKey(input.discoverySource, input.filePath, input.title);
    const existing = [...this.issues.values()].find((i) => i.dedupKey === dedupKey);
    if (existing) {
      for (const e of input.evidence) {
        if (!existing.evidence.some((x) => x.description === e.description)) {
          existing.evidence.push(e);
        }
      }
      if (SEVERITY_RANK[input.severity] > SEVERITY_RANK[existing.severity]) {
        existing.severity = input.severity;
      }
      existing.confidence = Math.max(existing.confidence, input.confidence);
      existing.blocksRelease = existing.blocksRelease || input.blocksRelease;
      return { issue: existing, created: false };
    }

    const now = new Date().toISOString();
    const issue: IssueRecord = {
      id: randomUUID(),
      runId: this.runId,
      dedupKey,
      title: input.title,
      description: input.description,
      category: input.category,
      severity: input.severity,
      confidence: input.confidence,
      filePath: input.filePath,
      lineStart: input.lineStart,
      lineEnd: input.lineEnd,
      evidence: [...input.evidence],
      impact: input.impact,
      remediation: input.remediation,
      verificationMethod: input.verificationMethod,
      blocksRelease: input.blocksRelease,
      state: "open",
      discoverySource: input.discoverySource,
      affectedRevision: input.affectedRevision,
      history: [
        { at: now, to: "open", actor: "system", reason: `Discovered by ${input.discoverySource}` },
      ],
      repairAttempts: 0,
      regressionTestName: input.regressionTestName,
    };
    this.issues.set(issue.id, issue);
    return { issue, created: true };
  }

  get(id: string): IssueRecord {
    const issue = this.issues.get(id);
    if (!issue) throw new LedgerError(`Issue ${id} not found`);
    return issue;
  }

  list(): IssueRecord[] {
    return [...this.issues.values()];
  }

  openMandatory(): IssueRecord[] {
    return this.list().filter((i) => i.blocksRelease && !RESOLVED_STATES.includes(i.state));
  }
  transition(
    id: string,
    to: IssueState,
    actor: IssueActor,
    reason: string,
    opts?: { authorization?: Authorization; evidenceRef?: string },
  ): IssueRecord {
    const issue = this.get(id);
    const from = issue.state;
    if (from === to) return issue;
    if (!TRANSITIONS[from].includes(to)) {
      throw new LedgerError(`Invalid issue transition ${from} -> ${to}`);
    }
    // Risk acceptance / false-positive disposition require authorization + reason + evidence.
    if (to === "accepted_risk" || to === "false_positive") {
      const auth = opts?.authorization;
      if (!auth) throw new LedgerError(`${to} requires an authorized human disposition`);
      if (!auth.reason || auth.reason.length < 5) {
        throw new LedgerError(`${to} requires a written justification`);
      }
      if (!opts?.evidenceRef) throw new LedgerError(`${to} requires supporting evidence`);
    }
    issue.state = to;
    issue.history.push({
      at: new Date().toISOString(),
      from,
      to,
      actor,
      reason: opts?.authorization
        ? `${reason} (by ${opts.authorization.actor}: ${opts.authorization.reason})`
        : reason,
      evidenceRef: opts?.evidenceRef,
    });
    return issue;
  }

  recordRepairAttempt(id: string): IssueRecord {
    const issue = this.get(id);
    issue.repairAttempts += 1;
    const from = issue.state;
    if (from === "repair_planned" || from === "repair_attempted" || from === "triaged") {
      issue.state = "repair_attempted";
    }
    issue.history.push({
      at: new Date().toISOString(),
      from,
      to: issue.state,
      actor: "repair",
      reason: `Repair attempt #${issue.repairAttempts}`,
    });
    return issue;
  }

  recordVerification(decision: VerificationDecision): IssueRecord {
    const issue = this.get(decision.issueId);
    issue.verification = decision;
    if (decision.verdict === "verified_fixed") {
      this.transition(issue.id, "verified_fixed", "verification", decision.rationale, {
        evidenceRef: decision.evidence[0]?.description,
      });
    } else if (decision.verdict === "rejected") {
      this.regressions += 1; // a rejected verification is a detected regression
      const to: IssueState =
        issue.state === "awaiting_verification" || issue.state === "verified_fixed"
          ? "reopened"
          : "blocked";
      this.transition(issue.id, to, "verification", `Rejected: ${decision.rationale}`);
    } else {
      this.transition(issue.id, "blocked", "verification", `Inconclusive: ${decision.rationale}`);
    }
    return issue;
  }

  metrics(): LedgerMetrics {
    const all = this.list();
    const acceptedRisk = all.filter((i) => i.state === "accepted_risk").length;
    const falsePositives = all.filter((i) => i.state === "false_positive").length;
    const verifiedFixes = all.filter((i) => i.state === "verified_fixed").length;
    const excluded = acceptedRisk + falsePositives;
    const denominator = Math.max(all.length - excluded, 0);
    return {
      initialFindings: all.length,
      remainingFindings: all.filter((i) => !RESOLVED_STATES.includes(i.state)).length,
      verifiedFixes,
      reopenedIssues: all.filter((i) => i.state === "reopened").length,
      newRegressions: this.regressions,
      failedRepairAttempts: all.reduce(
        (acc, i) => acc + (i.repairAttempts > 0 && i.state !== "verified_fixed" ? 1 : 0),
        0,
      ),
      acceptedRisk,
      falsePositives,
      blocked: all.filter((i) => i.state === "blocked").length,
      verifiedFixRate: denominator === 0 ? 0 : verifiedFixes / denominator,
      verifiedFixRateDenominator: denominator,
      verifiedFixRateExclusions: excluded,
    };
  }

  /** Restore ledger from stored records (persistence adapter). */
  hydrate(records: IssueRecord[]): void {
    for (const r of records) this.issues.set(r.id, r);
  }

  snapshot(): IssueRecord[] {
    return this.list().map((i) => ({ ...i, evidence: [...i.evidence], history: [...i.history] }));
  }
}


