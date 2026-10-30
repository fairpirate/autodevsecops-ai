import { describe, expect, it, vi } from "vitest";
import { executeAgent } from "../../services/orchestrator/src/agent-runtime";
import { redactAgentOutput } from "../../services/orchestrator/src/agent-cli";
import { createNebiusRepairProvider, NEBIUS_MODEL } from "@ads/orchestrator";
import review from "../../agents/examples/review.json";
import repair from "../../agents/examples/repair.json";
import verification from "../../agents/examples/verification.json";
import release from "../../agents/examples/release.json";

const testResult = (suite = "server:unit") => ({
  commitSha: "repaired-revision", environment: "unit-test-fixture", suite,
  platform: "server", passed: true, durationMs: 1, total: 1, failed: 0,
  timestamp: "2026-10-30T00:00:00.000Z",
});

// These synthetic records test the evaluator; they are not live execution evidence.
function verificationInput() {
  return { ...structuredClone(verification), targetedTests: [testResult()],
    regressionTests: [testResult()], securityScanPassed: true };
}
function releaseInput() {
  const input = structuredClone(release);
  return { ...input, issues: [], testResults: [testResult(), testResult("web:unit")], securityScanPassed: true,
    priorStagingDigest: input.artifact.digest,
    release: { ...input.release, securityScanStatus: "pass", qualityGateDecision: "pass", testEvidence: ["fixture:test-report"],
      approvals: [{ by: "human-fixture", at: "2026-10-30T00:00:00.000Z", environment: "PRODUCTION" }] } };
}

describe("standalone agent runtime", () => {
  it("executes the code and security analyzers with distinct finding sources", async () => {
    const code = await executeAgent("code-review", review);
    const security = await executeAgent("security-review", review);
    expect(code).toMatchObject({ mode: "deterministic", findings: [expect.objectContaining({ category: "error_handling" })] });
    expect(security).toMatchObject({ mode: "deterministic", findings: [expect.objectContaining({ category: "security" })] });
  });

  it("rejects executable command fields and traversal paths at the JSON boundary", async () => {
    await expect(executeAgent("code-review", { ...review, command: "shell command" })).rejects.toThrow();
    await expect(executeAgent("code-review", { ...review, files: { "../.env": "data" } })).rejects.toThrow();
  });

  it("returns a deterministic proposal without applying changes or claiming tests", async () => {
    const input = structuredClone(repair);
    const result = await executeAgent("repair", input);
    expect(result).toMatchObject({ status: "proposed", provider: "deterministic", applied: false, tokensUsed: 0,
      attempt: { updates: [{ path: "src/digest.js", content: expect.stringContaining('createHash("sha256")') }],
        result: { regressionTestsAdded: [], patchSizeLines: 2 } } });
    expect(input).toEqual(repair);
  });

  it("blocks untriaged issues, forbidden paths and oversized patches", async () => {
    for (const input of [
      { ...repair, issue: { ...repair.issue, state: "open" } },
      { ...repair, maxPatchSizeLines: 1 },
      { ...repair, issue: { ...repair.issue, filePath: "src/app.test.js" }, files: { "src/app.test.js": repair.files["src/digest.js"] } },
    ]) expect(await executeAgent("repair", input)).toMatchObject({ status: "blocked", applied: false });
  });

  it("requires an explicit configured provider for Nebius and does not silently fall back", async () => {
    const request = { ...repair, provider: "nebius" };
    expect(await executeAgent("repair", request)).toMatchObject({ status: "blocked" });
    const provider = { repair: vi.fn().mockRejectedValue(new Error("inference failed")) };
    await expect(executeAgent("repair", request, { aiRepair: provider })).rejects.toThrow("inference failed");
    expect(provider.repair).toHaveBeenCalledOnce();
  });

  it("uses validated Nebius output when that provider is selected (stubbed HTTP)", async () => {
    const provider = createNebiusRepairProvider({ apiKey: "fixture-key", fetch: vi.fn().mockResolvedValue(Response.json({
      model: NEBIUS_MODEL, usage: { total_tokens: 300 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        path: "src/digest.js", content: repair.files["src/digest.js"].replace('"md5"', '"sha256"'),
        explanation: "Replace the weak hash while retaining the digest function.", rootCause: "MD5 is collision-prone and unsafe for integrity checks.",
      }) } }],
    })) });
    expect(await executeAgent("repair", { ...repair, provider: "nebius" }, { aiRepair: provider }))
      .toMatchObject({ status: "proposed", provider: "nebius", model: NEBIUS_MODEL, tokensUsed: 300, applied: false });
  });

  it("cannot verify a fix with missing tests, missing scans, or unknown rules", async () => {
    expect(await executeAgent("verification", verification)).toMatchObject({ decision: { verdict: "inconclusive" } });
    const noScan = { ...verificationInput(), securityScanPassed: undefined };
    expect(await executeAgent("verification", noScan)).toMatchObject({ decision: { verdict: "inconclusive" } });
    const unknown = verificationInput();
    unknown.issue.title = "UNKNOWN: unrecognized rule";
    unknown.issue.evidence[0].reference = "UNKNOWN";
    expect(await executeAgent("verification", unknown)).toMatchObject({ decision: { verdict: "inconclusive", originalIssueAddressed: false } });
  });

  it("rejects mismatched issue identity or test revisions", async () => {
    const stale = verificationInput();
    stale.targetedTests[0].commitSha = "original-revision";
    await expect(executeAgent("verification", stale)).rejects.toThrow();
    await expect(executeAgent("verification", { ...verificationInput(), repair: { ...verification.repair, issueId: "other" } })).rejects.toThrow();
  });

  it("evaluates matching evidence but does not change any workflow state", async () => {
    const input = verificationInput();
    expect(await executeAgent("verification", input)).toMatchObject({ advisory: true, decision: { verdict: "verified_fixed" } });
    expect(input.issue.state).toBe("triaged");
    input.targetedTests[0].passed = false;
    expect(await executeAgent("verification", input)).toMatchObject({ decision: { verdict: "rejected" } });
  });

  it("requires release approvals, staging identity, executed scans and matching test evidence", async () => {
    expect(await executeAgent("release", release)).toMatchObject({ eligible: false, deployed: false, advisory: true });
    expect(await executeAgent("release", releaseInput())).toMatchObject({ eligible: true, deployed: false, advisory: true });
    for (const change of ["approvals", "staging", "scan", "revision", "artifact"] as const) {
      const input = releaseInput();
      if (change === "approvals") input.release.approvals = [];
      if (change === "staging") input.priorStagingDigest = "sha256:" + "b".repeat(64);
      if (change === "scan") input.release.securityScanStatus = "not_run";
      if (change === "revision") input.testResults[0].commitSha = "other";
      if (change === "artifact") input.release.artifactId = "other";
      expect(await executeAgent("release", input)).toMatchObject({ eligible: false, deployed: false });
    }
  });

  it("redacts credential snippets including dotted GitLab tokens", async () => {
    const secret = "glpat-" + "fixture_token_value.01.suffix";
    const input = { ...review, files: { "src/app.js": `const api_key = "${secret}";` } };
    const result = await executeAgent("security-review", input);
    const output = JSON.stringify(redactAgentOutput(result));
    expect(output).not.toContain(secret);
    expect(output).not.toContain("suffix");
    expect(output).toContain("AVSS04");
    expect(redactAgentOutput({ snippet: 'const password = "fixture-password";' })).toEqual({ snippet: 'const password = "***";' });
  });
});
