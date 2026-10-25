import { type NewIssueInput } from "@ads/issue-ledger";
import type { VerificationDecision } from "@ads/shared-types";

export function input(over: Partial<NewIssueInput> = {}): NewIssueInput {
  return {
    runId: "run1",
    title: "AVS101: Empty catch block swallows errors",
    description: "catch block with no handling at src/app.ts:10",
    category: "error_handling",
    severity: "high",
    confidence: 0.95,
    filePath: "src/app.ts",
    lineStart: 10,
    evidence: [{ kind: "analyzer_rule", description: "AVS101 matched", reference: "AVS101 @ src/app.ts:10" }],
    impact: "Failures are silently ignored.",
    remediation: "Handle the error.",
    verificationMethod: "Re-scan finds no empty catch.",
    blocksRelease: true,
    discoverySource: "deterministic:code-review",
    affectedRevision: "abc123",
    ...over,
  };
}

export function decision(issueId: string, over: Partial<VerificationDecision> = {}): VerificationDecision {
  return {
    issueId,
    verdict: "verified_fixed",
    confidence: 0.9,
    diffReviewed: true,
    testsReviewed: true,
    scannerOutputReviewed: true,
    originalIssueAddressed: true,
    regressionsIntroduced: [],
    evidence: [{ kind: "analyzer_rule", description: "rule cleared" }],
    rationale: "re-check confirms fix",
    reviewer: "independent-verification-agent",
    at: new Date().toISOString(),
    ...over,
  };
}
