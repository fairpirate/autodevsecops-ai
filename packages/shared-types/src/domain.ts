import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Workflow states (closed-loop review & repair engine)
 * ------------------------------------------------------------------ */

export const RUN_STATES = [
  "INITIALIZED",
  "CHECKOUT",
  "ANALYSIS",
  "ISSUE_TRIAGE",
  "REPAIR_PLANNING",
  "PATCH_GENERATION",
  "TARGETED_TESTS",
  "FULL_REGRESSION",
  "INDEPENDENT_REVIEW",
  "QUALITY_GATE",
  "NEXT_ITERATION",
  "READY_FOR_BUILD",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
  "NEEDS_HUMAN_REVIEW",
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const TERMINAL_RUN_STATES: readonly RunState[] = [
  "READY_FOR_BUILD",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
  "NEEDS_HUMAN_REVIEW",
];
export function isTerminal(s: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(s);
}

/* ------------------------------------------------------------------ *
 * Issues
 * ------------------------------------------------------------------ */

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ISSUE_CATEGORIES = [
  "functional_bug",
  "error_handling",
  "type_error",
  "code_quality",
  "performance",
  "security",
  "dependency_vulnerability",
  "api_contract",
  "missing_test",
  "accessibility",
  "mobile",
  "configuration",
  "backward_compatibility",
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const ISSUE_STATES = [
  "open",
  "triaged",
  "repair_planned",
  "repair_attempted",
  "awaiting_verification",
  "verified_fixed",
  "reopened",
  "accepted_risk",
  "false_positive",
  "blocked",
] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

/** Issues in these states no longer require repair work. */
export const RESOLVED_ISSUE_STATES: readonly IssueState[] = [
  "verified_fixed",
  "accepted_risk",
  "false_positive",
];

export interface IssueEvidence {
  /** Reproducible evidence: command output, rule id, file excerpt, scanner report line. */
  kind: "analyzer_rule" | "scanner" | "test_failure" | "ai_finding" | "human";
  description: string;
  /** e.g. `eslint(rule)`, `gosec(G101)`, `pytest::test_login`, file:line references */
  reference?: string;
  /** Raw supporting snippet (already redacted). */
  snippet?: string;
}

export interface IssueHistoryEntry {
  at: string; // ISO
  from?: IssueState;
  to: IssueState;
  actor: "system" | "code-review" | "security-review" | "repair" | "verification" | "release" | "human";
  reason: string;
  evidenceRef?: string;
}

export interface IssueRecord {
  id: string;
  runId: string;
  /** Stable dedup key: hash of rule id + normalized file + message fingerprint. */
  dedupKey: string;
  title: string;
  description: string;
  category: IssueCategory;
  severity: Severity;
  confidence: number; // 0..1
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  evidence: IssueEvidence[];
  impact: string;
  remediation: string;
  /** How an independent verifier can confirm the fix. */
  verificationMethod: string;
  blocksRelease: boolean;
  state: IssueState;
  discoverySource: string; // e.g. "deterministic:secrets", "duo-flow:code-review"
  affectedRevision: string; // commit SHA
  history: IssueHistoryEntry[];
  repairAttempts: number;
  relatedMergeRequestUrl?: string;
  regressionTestName?: string;
  verification?: VerificationDecision;
}

/* ------------------------------------------------------------------ *
 * AI agent outputs (structured, machine readable)
 * ------------------------------------------------------------------ */

export interface RepairResult {
  issueId: string;
  branch: string;
  commitSha?: string;
  /** Unified diff of the smallest reasonable patch. */
  diff: string;
  patchSizeLines: number;
  filesChanged: string[];
  explanation: string;
  regressionTestsAdded: string[];
  rootCause: string;
  selfAssessedRisk: "low" | "medium" | "high";
  requiresHumanReview: boolean;
  tokensUsed: number;
}

export interface VerificationDecision {
  issueId: string;
  verdict: "verified_fixed" | "rejected" | "inconclusive";
  confidence: number; // 0..1
  diffReviewed: boolean;
  testsReviewed: boolean;
  scannerOutputReviewed: boolean;
  originalIssueAddressed: boolean;
  regressionsIntroduced: string[];
  evidence: IssueEvidence[];
  rationale: string;
  reviewer: "independent-verification-agent";
  at: string;
}
