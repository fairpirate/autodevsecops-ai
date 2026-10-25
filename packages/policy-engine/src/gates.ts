import type { IssueRecord, QualityGateResult, Severity, TestResult } from "@ads/shared-types";

export interface PolicySet {
  /** Severities at which an open issue blocks release. */
  blockingSeverities: Severity[];
  /** Security issues at/above these severities must be verified fixed (never auto-suppressed). */
  securityPolicySeverities: Severity[];
  /** Mandatory suites that must pass (e.g. "server:unit", "web:unit"). */
  requiredSuites: string[];
  /** Minimum pass rate across executed tests, 0..1. */
  minTestPassRate: number;
  /** Whether a security scan must have run and passed. */
  requireSecurityScan: boolean;
  /** Approvals required per environment. */
  requiredApprovals: Record<"DEVELOPMENT" | "STAGING" | "PRODUCTION", number>;
  /** Production requires the exact artifact promoted through staging. */
  requireImmutablePromotion: boolean;
}

export const DEFAULT_POLICY: PolicySet = {
  blockingSeverities: ["critical", "high"],
  securityPolicySeverities: ["critical", "high"],
  requiredSuites: ["server:unit", "web:unit"],
  minTestPassRate: 0.8,
  requireSecurityScan: true,
  requiredApprovals: { DEVELOPMENT: 0, STAGING: 0, PRODUCTION: 1 },
  requireImmutablePromotion: true,
};

export interface GateInput {
  issues: IssueRecord[];
  testResults: TestResult[];
  securityScanPassed?: boolean; // undefined = not run
  policy?: Partial<PolicySet>;
}

/**
 * Evaluate mandatory quality gates. Structured and individually reported;
 * an arbitrary AI-generated percentage is NEVER an approval criterion.
 */
export function evaluateQualityGates(input: GateInput): QualityGateResult[] {
  const policy: PolicySet = { ...DEFAULT_POLICY, ...input.policy };
  const results: QualityGateResult[] = [];

  const isOpen = (state: IssueRecord["state"]) =>
    state !== "verified_fixed" && state !== "accepted_risk" && state !== "false_positive";

  const openBlocking = input.issues.filter(
    (i) => policy.blockingSeverities.includes(i.severity) && isOpen(i.state),
  );
  results.push({
    gate: "no_open_blocking_issues",
    passed: openBlocking.length === 0,
    required: true,
    detail:
      openBlocking.length === 0
        ? "No open issues at blocking severities"
        : `${openBlocking.length} open blocking issue(s): ${openBlocking
            .map((i) => `${i.severity}:${i.title}`)
            .slice(0, 5)
            .join("; ")}`,
  });

  // Security findings at policy severities are never auto-suppressed by an AI opinion.
  const openSec = input.issues.filter(
    (i) =>
      i.category === "security" &&
      policy.securityPolicySeverities.includes(i.severity) &&
      isOpen(i.state),
  );
  results.push({
    gate: "security_policy",
    passed: openSec.length === 0,
    required: true,
    detail:
      openSec.length === 0
        ? "No unresolved critical/high security findings"
        : `${openSec.length} unresolved security finding(ies) at policy severity`,
  });

  if (policy.requireSecurityScan) {
    results.push({
      gate: "security_scan_executed",
      passed: input.securityScanPassed === true,
      required: true,
      detail:
        input.securityScanPassed === true
          ? "Security scan ran and passed"
          : input.securityScanPassed === false
            ? "Security scan failed"
            : "Security scan has not run",
    });
  }

  const missing = policy.requiredSuites.filter((s) => !input.testResults.some((r) => r.suite === s));
  const failedRequired = input.testResults.filter(
    (r) => policy.requiredSuites.includes(r.suite) && !r.passed,
  );
  results.push({
    gate: "required_test_suites",
    passed: missing.length === 0 && failedRequired.length === 0,
    required: true,
    detail:
      missing.length === 0 && failedRequired.length === 0
        ? `All required suites passed (${policy.requiredSuites.join(", ")})`
        : [
            missing.length ? `missing: ${missing.join(", ")}` : "",
            failedRequired.length ? `failed: ${failedRequired.map((r) => r.suite).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("; "),
  });

  const totalCases = input.testResults.reduce((a, r) => a + (r.total ?? 1), 0);
  const passedCases = input.testResults.reduce(
    (a, r) => a + (r.passed ? (r.total ?? 1) : (r.total ?? 1) - (r.failed ?? 1)),
    0,
  );
  const passRate = totalCases === 0 ? 0 : passedCases / totalCases;
  results.push({
    gate: "test_pass_rate",
    passed: input.testResults.length > 0 && passRate >= policy.minTestPassRate,
    required: true,
    detail: `Pass rate ${(passRate * 100).toFixed(1)}% (required >= ${(policy.minTestPassRate * 100).toFixed(0)}%) over ${totalCases} test(s)`,
  });

  return results;
}

export function gatesPassed(results: QualityGateResult[]): boolean {
  return results.filter((r) => r.required).every((r) => r.passed);
}
