import { describe, expect, it, vi } from "vitest";
import { Orchestrator, createNebiusRepairProvider, NEBIUS_MODEL, type ExecutorHost, type FileMap } from "@ads/orchestrator";
import type { TestResult } from "@ads/shared-types";

const original = 'exports.digest = (v) => createHash("md5").update(v).digest("hex");';
function setup(options: { applyOk?: boolean; testsPass?: boolean; modelContent?: string; inferenceFails?: boolean } = {}) {
  let files: FileMap = { "src/digest.js": original, "src/digest.test.js": 'test("digest", () => {});' };
  const testedShas: string[] = [];
  const test = (suite: string, sha: string): TestResult => {
    testedShas.push(sha);
    return { suite, commitSha: sha, platform: "server", environment: "test", passed: options.testsPass !== false,
      durationMs: 1, timestamp: new Date().toISOString() };
  };
  const host: ExecutorHost = {
    async checkout() { return { ok: true, files: { ...files }, commitSha: "original" }; },
    applyPatch: vi.fn(async (_id, _branch, updates) => {
      if (options.applyOk === false) return { ok: false, detail: "failed" };
      for (const u of updates) files[u.path] = u.content;
      return { ok: true, commitSha: "repaired" };
    }),
    async runTargetedTests(_id, ctx) { return [test("server:unit", ctx.commitSha)]; },
    async runFullRegression(_id, ctx) { return [test("server:unit", ctx.commitSha), test("web:unit", ctx.commitSha)]; },
    async runSecurityScan() { return { passed: true, findings: [], tool: "test" }; },
  };
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ model: NEBIUS_MODEL, usage: { total_tokens: 250 },
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ path: "src/digest.js",
      content: options.modelContent ?? original.replace("md5", "sha256"),
      explanation: "Replace the collision-prone hash while preserving the API. Tests passed (model assertion).",
      rootCause: "MD5 is cryptographically weak." }) } }],
  }), { status: options.inferenceFails ? 503 : 200 }));
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const orch = new Orchestrator({ host, aiRepair: createNebiusRepairProvider({ apiKey: "test-only", fetch: fetcher }),
    events: { emit(_id, type, payload) { events.push({ type, payload }); } } });
  const run = orch.createRun({ projectId: "p", gitlabProjectId: 1, ref: "main", commitSha: "original" });
  return { orch, run, host, fetcher, events, testedShas };
}

describe("Nebius-backed orchestration (stubbed inference boundary)", () => {
  it("accounts usage and tests the repaired revision before accepting a fix", async () => {
    const s = setup();
    await s.orch.run(s.run.id);
    expect(s.run.state).toBe("READY_FOR_BUILD");
    expect(s.run.tokensUsed).toBe(250);
    expect(s.testedShas.length).toBeGreaterThan(0);
    expect(s.testedShas.every((sha) => sha === "repaired")).toBe(true);
    expect(s.orch.getSession(s.run.id)!.ledger.metrics()).toMatchObject({ verifiedFixes: 1, verifiedFixRateDenominator: 1, verifiedFixRateExclusions: 0 });
    expect(s.events.find((event) => event.type === "repair_generated")?.payload).toMatchObject({ provider: "nebius", model: NEBIUS_MODEL, tokensUsed: 250 });
  });
  it("cannot accept the model's assertion of passed tests when executed tests fail", async () => {
    const s = setup({ testsPass: false });
    await s.orch.run(s.run.id);
    expect(s.run.state).toBe("BLOCKED");
    expect(s.orch.getSession(s.run.id)!.ledger.metrics().verifiedFixes).toBe(0);
  });
  it("keeps the original tree when committing the generated patch fails", async () => {
    const s = setup({ applyOk: false });
    await s.orch.run(s.run.id);
    expect(s.orch.getSession(s.run.id)!.files["src/digest.js"]).toBe(original);
    expect(s.orch.getSession(s.run.id)!.ledger.metrics().verifiedFixes).toBe(0);
    expect(s.run.tokensUsed).toBe(250);
    expect(s.testedShas.every((sha) => sha === "original")).toBe(true);
  });
  it("blocks a failed provider without applying a deterministic substitute", async () => {
    const s = setup({ inferenceFails: true });
    await s.orch.run(s.run.id);
    expect(s.host.applyPatch).not.toHaveBeenCalled();
    expect(s.orch.getSession(s.run.id)!.ledger.metrics().verifiedFixes).toBe(0);
    expect(s.events.find((event) => event.type === "error")?.payload.message).toBe("Nebius inference failed (HTTP 503)");
  });
});
