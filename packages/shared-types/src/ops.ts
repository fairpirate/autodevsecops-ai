/* Tests, gates, artifacts, deployments, budgets, events */

export const TEST_PLATFORMS = ["web", "server", "mobile"] as const;
export type TestPlatform = (typeof TEST_PLATFORMS)[number];

export interface TestResult {
  commitSha: string;
  artifactId?: string;
  environment: string;
  suite: string;
  platform: TestPlatform;
  passed: boolean;
  durationMs: number;
  failureSummary?: string;
  logLink?: string;
  total?: number;
  failed?: number;
  skipped?: number;
  timestamp: string;
}

export interface QualityGateResult {
  gate: string;
  passed: boolean;
  required: boolean;
  detail: string;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  sourceCommitSha: string;
  pipelineId?: string;
  /** sha256:<hex> container digest or package checksum. */
  digest: string;
  kind: "container_image" | "web_bundle" | "android_package" | "server_package";
  buildJobId?: string;
  metadata: Record<string, string>;
  createdAt: string;
}

export const ENVIRONMENTS = ["DEVELOPMENT", "STAGING", "PRODUCTION"] as const;
export type EnvironmentName = (typeof ENVIRONMENTS)[number];

export interface ReleaseRecord {
  id: string;
  artifactId: string;
  sourceCommitSha: string;
  artifactDigest: string;
  testEvidence: string[];
  securityScanStatus: "pass" | "fail" | "not_run";
  qualityGateDecision: string;
  approvals: Array<{ by: string; at: string; environment: EnvironmentName }>;
  createdAt: string;
}

export interface DeploymentRecord {
  id: string;
  releaseId: string;
  environment: EnvironmentName;
  status:
    | "pending_approval"
    | "approved"
    | "in_progress"
    | "deployed"
    | "failed"
    | "rolled_back"
    | "rejected";
  artifactDigest: string;
  sourceCommitSha: string;
  startedAt?: string;
  finishedAt?: string;
  healthChecks: Array<{ name: string; ok: boolean; detail: string; at: string }>;
  rollbackAvailable: boolean;
  rollbackOfDeploymentId?: string;
  auditTrail: Array<{ at: string; actor: string; action: string; detail: string }>;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Execution budgets & run configuration
 * ------------------------------------------------------------------ */

export interface RunBudget {
  maxIterations: number;
  maxRuntimeMs: number;
  maxTokenBudget: number;
  maxPatchSizeLines: number;
  maxConcurrentRepairs: number;
  maxRepeatedFailures: number;
  minVerificationConfidence: number;
}

export const DEFAULT_BUDGET: RunBudget = {
  maxIterations: 5,
  maxRuntimeMs: 60 * 60 * 1000,
  maxTokenBudget: 200_000,
  maxPatchSizeLines: 400,
  maxConcurrentRepairs: 2,
  maxRepeatedFailures: 2,
  minVerificationConfidence: 0.75,
};

export type StopReason =
  | "all_mandatory_issues_fixed"
  | "no_progress"
  | "repeated_failure"
  | "budget_exhausted"
  | "critical_policy_violation"
  | "required_test_failed"
  | "security_scan_failed"
  | "cancelled_by_user"
  | "max_iterations";

export interface RunRecord {
  id: string;
  projectId: string;
  gitlabProjectId: number;
  ref: string;
  commitSha: string;
  state: RunState2;
  iteration: number;
  budget: RunBudget;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  stopReason?: StopReason;
  parentRunId?: string;
  workspacePath?: string;
  failureFingerprints: Record<string, number>;
  noProgressIterations: number;
  tokensUsed: number;
  costEstimateUsd: number;
}

/* Re-export to avoid circular import gymnastics */
import type { RunState as RunState2 } from "./domain";

/* ------------------------------------------------------------------ *
 * Events (SSE live updates)
 * ------------------------------------------------------------------ */

export interface RunEvent {
  id: number;
  runId: string;
  type:
    | "state_changed"
    | "issue_found"
    | "issue_updated"
    | "iteration_started"
    | "repair_generated"
    | "test_result"
    | "verification"
    | "quality_gate"
    | "log"
    | "error"
    | "completed";
  at: string;
  payload: Record<string, unknown>;
}
