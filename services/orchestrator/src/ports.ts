import type { TestResult } from "@ads/shared-types";
import type { NewIssueInput } from "@ads/issue-ledger";

/** Map of file path -> content in the checked-out workspace. */
export type FileMap = Record<string, string>;

export interface CheckoutResult {
  ok: boolean;
  files: FileMap;
  commitSha: string;
  detail?: string;
}

export interface SecurityScanResult {
  passed: boolean;
  findings: NewIssueInput[];
  tool: string;
}

/**
 * Host interface the orchestrator uses for side-effecting operations.
 * Implementations: GitLab-backed (production), local workspace (demo),
 * fakes (tests). Keeps the orchestrator itself deterministic and testable.
 */
export interface ExecutorHost {
  checkout(runId: string, projectRef: string, commitSha: string): Promise<CheckoutResult>;
  /** Targeted tests: suites related to repaired issues only. */
  runTargetedTests(runId: string, ctx: { commitSha: string }): Promise<TestResult[]>;
  /** Full regression across web/server/mobile suites (as configured). */
  runFullRegression(runId: string, ctx: { commitSha: string }): Promise<TestResult[]>;
  /** Deterministic security scan (and external scanners when configured). */
  runSecurityScan(runId: string, files: FileMap): Promise<SecurityScanResult>;
  /** Persist a generated patch into the isolated repair branch (never a protected branch). */
  applyPatch(
    runId: string,
    branch: string,
    files: Array<{ path: string; content: string }>,
    message: string,
  ): Promise<{ ok: boolean; commitSha?: string; detail?: string }>;
}

export interface RunEventSink {
  emit(runId: string, type: string, payload: Record<string, unknown>): void;
}
