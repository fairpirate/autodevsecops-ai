import { IssueLedger } from "@ads/issue-ledger";
import { checkEnvironmentEligibility, evaluateQualityGates, gatesPassed } from "@ads/policy-engine";
import { verifyArtifactIdentity } from "@ads/artifact-service";
import { analyzeMissingTests, runCodeReview, runSecurityReview } from "./analyzers";
import { assertNoModelSecrets, isModelSourcePath, type AIRepairProvider } from "./nebius";
import { attemptDeterministicRepair, unifiedDiff } from "./repair";
import { verifyRepair } from "./verification";
import { createTavilySearcher, type TavilySearcher } from "./tavily";
import { repairAgentInputSchema, releaseAgentInputSchema, reviewAgentInputSchema, verificationAgentInputSchema } from "./agent-schemas";

export const AGENT_NAMES = ["code-review", "security-review", "repair", "verification", "release"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

/** Standalone role execution; never changes workflow state, writes patches, or deploys. */
export async function executeAgent(name: AgentName, input: unknown, deps: { aiRepair?: AIRepairProvider; tavilySearch?: TavilySearcher } = {}) {
  switch (name) {
    case "code-review":
    case "security-review": {
      const request = reviewAgentInputSchema.parse(input);
      const findings = name === "security-review"
        ? runSecurityReview(request.runId, request.commitSha, request.files)
        : [...runCodeReview(request.runId, request.commitSha, request.files),
          ...analyzeMissingTests(request.runId, request.commitSha, request.files, request.changedPaths ?? Object.keys(request.files))];

      // Enrich dependency_vulnerability findings with live CVE/advisory context
      // from Tavily web search. Degradation-safe: deterministic findings remain
      // even when TAVILY_API_KEY is absent or the search call fails.
      const enriched = await Promise.all(findings.map(async (finding) => {
        if (name !== "security-review" || finding.input.category !== "dependency_vulnerability" || !deps.tavilySearch) {
          return finding;
        }
        try {
          const search = await deps.tavilySearch.search({
            query: `${finding.input.title} CVE advisory`,
            maxResults: 3,
            includeAnswer: true,
            includeRawContent: false,
            searchDepth: "basic",
          });
          const webEvidence: typeof finding.input.evidence = [
            ...finding.input.evidence,
            ...search.results.map((r) => ({
              kind: "ai_finding" as const,
              description: r.title,
              reference: r.url,
              snippet: r.content.slice(0, 300),
            })),
          ];
          if (search.answer) {
            webEvidence.push({
              kind: "ai_finding" as const,
              description: "Tavily answer: " + search.answer.slice(0, 300),
              reference: "tavily://answer",
            });
          }
          return {
            ...finding,
            input: {
              ...finding.input,
              evidence: webEvidence,
              discoverySource: `${finding.input.discoverySource}+tavily`,
            },
          };
        } catch {
          return finding;
        }
      }));

      const ledger = new IssueLedger(request.runId);
      for (const finding of enriched) ledger.addFinding(finding.input);
      return { agent: name, mode: "deterministic", findings: ledger.snapshot() };
    }
    case "repair": {
      const request = repairAgentInputSchema.parse(input);
      const blocked = (reason: string) => ({ agent: name, status: "blocked", reason, applied: false });
      if (!["triaged", "repair_planned", "reopened"].includes(request.issue.state)) {
        return blocked("Issue must be triaged before repair planning");
      }
      const path = request.issue.filePath ?? "";
      const before = request.files[path];
      if (!isModelSourcePath(path) || before === undefined) return blocked("Repair requires an eligible existing source file");
      assertNoModelSecrets(before, "");
      if (request.provider === "nebius") {
        if (!deps.aiRepair) return blocked("Nebius provider is not configured");
        const response = await deps.aiRepair.repair({ ...request, runId: request.issue.runId });
        return { agent: name, status: "proposed", applied: false, provider: "nebius", ...response };
      }
      const attempt = attemptDeterministicRepair(request.issue, request.files, request.issue.runId, request.iteration);
      if (!attempt) return blocked("No deterministic repair is available; select Nebius explicitly or request human review");
      // Count additions and deletions, including pure-deletion repairs.
      const patchSize = attempt.updates.reduce((sum, update) => sum + unifiedDiff(update.path, request.files[update.path], update.content)
        .split("\n").slice(2).filter((line) => /^[+-]/.test(line)).length, 0);
      if (patchSize > request.maxPatchSizeLines) return blocked("Patch exceeds the requested line budget");
      attempt.result.patchSizeLines = patchSize;
      return { agent: name, status: "proposed", applied: false, provider: "deterministic", tokensUsed: 0, attempt };
    }
    case "verification": {
      const request = verificationAgentInputSchema.parse(input);
      return { agent: name, mode: "deterministic", advisory: true, decision: verifyRepair(request) };
    }
    case "release": {
      const request = releaseAgentInputSchema.parse(input);
      const { release, artifact, environment } = request;
      const identity = verifyArtifactIdentity(release, artifact);
      const approvals = new Set(release.approvals.filter((approval) => approval.environment === environment).map((approval) => approval.by)).size;
      const eligibility = checkEnvironmentEligibility(release, environment, request.priorStagingDigest, approvals);
      const gates = evaluateQualityGates(request);
      const reasons = [...identity.reasons, ...eligibility.reasons,
        ...gates.filter((gate) => gate.required && !gate.passed).map((gate) => gate.detail)];
      if (release.testEvidence.length === 0) reasons.push("Release has no test evidence references");
      if (request.testResults.some((test) => test.commitSha !== artifact.sourceCommitSha || (test.artifactId && test.artifactId !== artifact.id))) {
        reasons.push("Test evidence does not match the release artifact/revision");
      }
      return { agent: name, advisory: true, releaseId: release.id, environment,
        eligible: identity.ok && eligibility.eligible && gatesPassed(gates) && reasons.length === 0,
        reasons, artifactDigest: artifact.digest, gates, deployed: false };
    }
  }
}
