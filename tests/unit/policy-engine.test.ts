import { describe, expect, it } from "vitest";
import type { IssueRecord, ReleaseRecord, TestResult } from "@ads/shared-types";
import { checkEnvironmentEligibility, evaluateQualityGates, gatesPassed } from "@ads/policy-engine";

function issue(over: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: "i1",
    runId: "r1",
    dedupKey: "k",
    title: "critical thing",
    description: "d",
    category: "security",
    severity: "critical",
    confidence: 0.9,
    evidence: [],
    impact: "i",
    remediation: "r",
    verificationMethod: "v",
    blocksRelease: true,
    state: "open",
    discoverySource: "deterministic:security-review",
    affectedRevision: "abc",
    history: [],
    repairAttempts: 0,
    ...over,
  };
}

function result(suite: string, passed: boolean, over: Partial<TestResult> = {}): TestResult {
  return {
    commitSha: "abc",
    environment: "local",
    suite,
    platform: "server",
    passed,
    durationMs: 10,
    total: 10,
    failed: passed ? 0 : 10,
    timestamp: new Date().toISOString(),
    ...over,
  };
}

function release(over: Partial<ReleaseRecord> = {}): ReleaseRecord {
  return {
    id: "rel1",
    artifactId: "a1",
    sourceCommitSha: "abc",
    artifactDigest: "sha256:" + "a".repeat(64),
    testEvidence: [],
    securityScanStatus: "pass",
    qualityGateDecision: "pass",
    approvals: [],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("quality gates", () => {
  it("fails when critical issues remain open", () => {
    const gates = evaluateQualityGates({
      issues: [issue()],
      testResults: [result("server:unit", true), result("web:unit", true)],
      securityScanPassed: true,
    });
    expect(gatesPassed(gates)).toBe(false);
    expect(gates.find((g) => g.gate === "no_open_blocking_issues")?.passed).toBe(false);
    expect(gates.find((g) => g.gate === "security_policy")?.passed).toBe(false);
  });

  it("passes when mandatory issues are verified fixed and suites pass", () => {
    const gates = evaluateQualityGates({
      issues: [issue({ state: "verified_fixed" })],
      testResults: [result("server:unit", true), result("web:unit", true)],
      securityScanPassed: true,
    });
    expect(gatesPassed(gates)).toBe(true);
  });

  it("fails when a required suite is missing", () => {
    const gates = evaluateQualityGates({
      issues: [],
      testResults: [result("server:unit", true)],
      securityScanPassed: true,
    });
    expect(gatesPassed(gates)).toBe(false);
    expect(gates.find((g) => g.gate === "required_test_suites")?.detail).toContain("missing");
  });

  it("fails when the security scan has not run", () => {
    const gates = evaluateQualityGates({
      issues: [],
      testResults: [result("server:unit", true), result("web:unit", true)],
    });
    expect(gates.find((g) => g.gate === "security_scan_executed")?.passed).toBe(false);
  });
});

describe("environment eligibility", () => {
  const digest = "sha256:" + "a".repeat(64);
  const other = "sha256:" + "b".repeat(64);

  it("requires production approvals", () => {
    const e = checkEnvironmentEligibility(release(), "PRODUCTION", digest, 0);
    expect(e.eligible).toBe(false);
    expect(e.reasons[0]).toContain("approval");
  });

  it("requires the identical artifact digest promoted through staging", () => {
    const withApproval = release({ approvals: [{ by: "ops", at: "t", environment: "PRODUCTION" }] });
    const mismatch = checkEnvironmentEligibility(withApproval, "PRODUCTION", other, 1);
    expect(mismatch.eligible).toBe(false);
    expect(mismatch.reasons.join(" ")).toContain("immutable");

    const match = checkEnvironmentEligibility(withApproval, "PRODUCTION", digest, 1);
    expect(match.eligible).toBe(true);
  });

  it("blocks promotion when staging never received the artifact", () => {
    const e = checkEnvironmentEligibility(release(), "PRODUCTION", undefined, 1);
    expect(e.eligible).toBe(false);
    expect(e.reasons.join(" ")).toContain("STAGING");
  });

  it("blocks releases with failed gates or failed security scans", () => {
    const bad = release({ qualityGateDecision: "fail", securityScanStatus: "fail" });
    const e = checkEnvironmentEligibility(bad, "DEVELOPMENT", undefined, 0);
    expect(e.eligible).toBe(false);
    expect(e.reasons).toHaveLength(2);
  });
});
