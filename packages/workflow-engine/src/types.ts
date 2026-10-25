import type { IssueRecord, RunBudget, RunState, StopReason, VerificationDecision } from "@ads/shared-types";

/** Signals produced by the orchestrator for the current step. */
export interface StepSignals {
  ok: boolean;
  /** Optional machine-readable failure fingerprint (for repeated-failure detection). */
  failureFingerprint?: string;
  /** Verification decisions produced in INDEPENDENT_REVIEW. */
  verifications?: VerificationDecision[];
  /** Quality gate outcomes produced in QUALITY_GATE. */
  gatePassed?: boolean;
  /** e.g. critical policy violation detected. */
  criticalPolicyViolation?: boolean;
  /** Test/scanner category that failed, used for stop reasons. */
  failedRequirement?: "targeted_tests" | "regression" | "security_scan";
  tokensUsed?: number;
  detail?: string;
}

export interface EngineContext {
  state: RunState;
  iteration: number;
  budget: RunBudget;
  startedAtMs: number;
  nowMs: number;
  tokensUsed: number;
  noProgressIterations: number;
  failureFingerprints: Record<string, number>;
  cancelled?: boolean;
  /** Safety valve: iterate the machine until it reaches a stable state. */
  maxTransitions?: number;
}

export interface TransitionResult {
  context: EngineContext;
  applied: Array<{ from: RunState; to: RunState; reason: string }>;
  stopReason?: StopReason;
  terminal: boolean;
}

/**
 * "Progress" during a loop iteration means at least one of:
 *  - an open mandatory issue became verified_fixed / false_positive / accepted_risk
 *  - the count of open mandatory issues strictly decreased
 */
export interface ProgressReport {
  progressMade: boolean;
  openMandatoryBefore: number;
  openMandatoryAfter: number;
  newlyFixed: string[];
}

export function measureProgress(before: IssueRecord[], after: IssueRecord[]): ProgressReport {
  const openMandatory = (list: IssueRecord[]) =>
    list.filter((i) => i.blocksRelease && !isResolved(i.state)).length;
  const resolvedNow = after
    .filter(
      (a) => isResolved(a.state) && !before.some((b) => b.id === a.id && b.state === a.state),
    )
    .map((i) => i.id);
  const b = openMandatory(before);
  const a = openMandatory(after);
  return {
    progressMade: a < b || resolvedNow.length > 0,
    openMandatoryBefore: b,
    openMandatoryAfter: a,
    newlyFixed: resolvedNow,
  };
}

function isResolved(state: IssueRecord["state"]): boolean {
  return state === "verified_fixed" || state === "accepted_risk" || state === "false_positive";
}
