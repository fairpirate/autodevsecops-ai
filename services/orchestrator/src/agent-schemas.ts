import { z } from "zod";
import { ENVIRONMENTS, ISSUE_CATEGORIES, ISSUE_STATES, SEVERITIES, TEST_PLATFORMS } from "@ads/shared-types";

const text = z.string().min(1).max(200_000);
const path = z.string().min(1).max(500).refine(
  (value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => ["..", ".", ""].includes(part)),
  "Use a relative repository path",
);
const files = z.record(path, z.string().max(200_000)).refine((value) => Object.keys(value).length <= 400);
const evidence = z.object({
  kind: z.enum(["analyzer_rule", "scanner", "test_failure", "ai_finding", "human"]),
  description: text, reference: text.optional(), snippet: z.string().optional(),
});
const decision = z.object({
  issueId: text, verdict: z.enum(["verified_fixed", "rejected", "inconclusive"]),
  confidence: z.number().min(0).max(1), diffReviewed: z.boolean(), testsReviewed: z.boolean(),
  scannerOutputReviewed: z.boolean(), originalIssueAddressed: z.boolean(),
  regressionsIntroduced: z.array(text), evidence: z.array(evidence), rationale: text,
  reviewer: z.literal("independent-verification-agent"), at: z.string().datetime(),
});
export const agentIssueSchema = z.object({
  id: text, runId: text, dedupKey: text, title: text, description: text,
  category: z.enum(ISSUE_CATEGORIES), severity: z.enum(SEVERITIES), confidence: z.number().min(0).max(1),
  filePath: path.optional(), lineStart: z.number().int().positive().optional(), lineEnd: z.number().int().positive().optional(),
  evidence: z.array(evidence), impact: text, remediation: text, verificationMethod: text,
  blocksRelease: z.boolean(), state: z.enum(ISSUE_STATES), discoverySource: text, affectedRevision: text,
  history: z.array(z.object({
    at: z.string().datetime(), from: z.enum(ISSUE_STATES).optional(), to: z.enum(ISSUE_STATES),
    actor: z.enum(["system", "code-review", "security-review", "repair", "verification", "release", "human"]),
    reason: text, evidenceRef: text.optional(),
  })),
  repairAttempts: z.number().int().nonnegative(), relatedMergeRequestUrl: z.string().url().optional(),
  regressionTestName: text.optional(), verification: decision.optional(),
});
const repair = z.object({
  issueId: text, branch: z.string().regex(/^autofix\/[\w/-]+$/), commitSha: text.optional(),
  diff: text, patchSizeLines: z.number().int().nonnegative(), filesChanged: z.array(path).min(1),
  explanation: text, regressionTestsAdded: z.array(path), rootCause: text,
  selfAssessedRisk: z.enum(["low", "medium", "high"]), requiresHumanReview: z.boolean(),
  tokensUsed: z.number().int().nonnegative(),
});
const testResult = z.object({
  commitSha: text, artifactId: text.optional(), environment: text, suite: text, platform: z.enum(TEST_PLATFORMS),
  passed: z.boolean(), durationMs: z.number().nonnegative(), failureSummary: text.optional(), logLink: text.optional(),
  total: z.number().int().nonnegative().optional(), failed: z.number().int().nonnegative().optional(),
  skipped: z.number().int().nonnegative().optional(), timestamp: z.string().datetime(),
}).refine((value) => !value.passed || (value.failed ?? 0) === 0, "Passing tests cannot include failures");
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const artifact = z.object({
  id: text, runId: text, sourceCommitSha: text, pipelineId: text.optional(), digest,
  kind: z.enum(["container_image", "web_bundle", "android_package", "server_package"]),
  buildJobId: text.optional(), metadata: z.record(z.string()), createdAt: z.string().datetime(),
});
const release = z.object({
  id: text, artifactId: text, sourceCommitSha: text, artifactDigest: digest, testEvidence: z.array(text),
  securityScanStatus: z.enum(["pass", "fail", "not_run"]), qualityGateDecision: text,
  approvals: z.array(z.object({ by: text, at: z.string().datetime(), environment: z.enum(ENVIRONMENTS) })),
  createdAt: z.string().datetime(),
});

export const reviewAgentInputSchema = z.object({
  runId: text, commitSha: text, files, changedPaths: z.array(path).optional(),
}).strict();
export const repairAgentInputSchema = z.object({
  issue: agentIssueSchema, files, iteration: z.number().int().min(1).max(20).default(1),
  provider: z.enum(["deterministic", "nebius"]).default("deterministic"),
  maxPatchSizeLines: z.number().int().positive().max(400).default(400),
  remainingTokens: z.number().int().nonnegative().max(200_000).default(20_000),
}).strict();
export const verificationAgentInputSchema = z.object({
  issue: agentIssueSchema, repair, filesAfter: files, targetedTests: z.array(testResult),
  regressionTests: z.array(testResult), securityScanPassed: z.boolean().optional(),
}).strict().refine((value) => value.issue.id === value.repair.issueId, "Repair must reference the issue")
  .refine((value) => Boolean(value.repair.commitSha) && [...value.targetedTests, ...value.regressionTests]
    .every((test) => test.commitSha === value.repair.commitSha), "Tests must reference the repaired commit");
export const releaseAgentInputSchema = z.object({
  release, artifact, environment: z.enum(ENVIRONMENTS), priorStagingDigest: digest.optional(),
  issues: z.array(agentIssueSchema), testResults: z.array(testResult), securityScanPassed: z.boolean().optional(),
}).strict();
