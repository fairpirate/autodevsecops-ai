import { describe, expect, it, vi } from "vitest";
import { createNebiusRepairProvider, isModelSourcePath, assertNoModelSecrets, NEBIUS_MODEL } from "../../services/orchestrator/src/nebius";
import { IssueLedger } from "@ads/issue-ledger";
import { runSecurityReview } from "@ads/orchestrator";
import { loadConfig } from "../../apps/control-api/src/config";

const before = 'exports.digest = (v) => createHash("md5").update(v).digest("hex");';
const after = before.replace("md5", "sha256");
function request() {
  const ledger = new IssueLedger("run");
  const finding = runSecurityReview("run", "sha", { "src/digest.js": before })[0];
  const { issue } = ledger.addFinding(finding.input);
  return { issue, files: { "src/digest.js": before }, runId: "run", iteration: 1, maxPatchSizeLines: 20, remainingTokens: 20_000 };
}
function envelope(patch: unknown, finish = "stop") {
  return new Response(JSON.stringify({ model: NEBIUS_MODEL, usage: { total_tokens: 123 }, choices: [
    { finish_reason: finish, message: { content: JSON.stringify(patch) } },
  ] }));
}
const patch = { path: "src/digest.js", content: after, explanation: "Replace obsolete MD5 with SHA-256 while preserving the digest API.", rootCause: "MD5 is cryptographically weak." };

describe("Nebius inference boundary", () => {
  it("calls the documented endpoint and validates a patch with actual usage", async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(patch));
    const provider = createNebiusRepairProvider({ apiKey: "test-only", fetch: fetcher });
    const result = await provider.repair(request());
    expect(fetcher.mock.calls[0][0]).toBe("https://api.tokenfactory.us-central1.nebius.com/v1/chat/completions");
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).model).toBe(NEBIUS_MODEL);
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string).messages).not.toContainEqual(expect.objectContaining({ content: expect.stringContaining("test-only") }));
    expect(result.tokensUsed).toBe(123);
    expect(result.attempt.updates).toEqual([{ path: patch.path, content: after }]);
    expect(result.attempt.result.branch).toMatch(/^autofix\//);
  });
  it.each([
    { ...patch, path: "../../outside.js" },
    { ...patch, path: "src/digest.test.js" },
    { ...patch, content: before },
    { ...patch, content: "// deleted" },
    { ...patch, content: `${after}\nconst token = 'private-token-value';` },
    { ...patch, extra: "unexpected" },
  ])("rejects invalid or unsafe model output", async (output) => {
    const provider = createNebiusRepairProvider({ apiKey: "test-only", fetch: vi.fn().mockResolvedValue(envelope(output)) });
    await expect(provider.repair(request())).rejects.toThrow();
  });
  it("rejects truncated output and oversized patches", async () => {
    const provider = createNebiusRepairProvider({ apiKey: "test-only", fetch: vi.fn().mockResolvedValue(envelope(patch, "length")) });
    await expect(provider.repair(request())).rejects.toThrow("incomplete");
    const large = createNebiusRepairProvider({ apiKey: "test-only", fetch: vi.fn().mockResolvedValue(envelope(patch)) });
    await expect(large.repair({ ...request(), maxPatchSizeLines: 1 })).rejects.toThrow("line budget");
  });
  it("never sends secrets or low-budget requests to inference", async () => {
    const fetcher = vi.fn();
    const provider = createNebiusRepairProvider({ apiKey: "test-only", fetch: fetcher });
    await expect(provider.repair({ ...request(), remainingTokens: 100 })).rejects.toThrow("budget");
    const req = request();
    req.files["src/digest.js"] += '\nconst api_key = "private-value-here";';
    await expect(provider.repair(req)).rejects.toThrow("credential");
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => assertNoModelSecrets("test-only", "test-only")).toThrow();
  });
  it("does not expose provider errors that echo credentials", async () => {
    const provider = createNebiusRepairProvider({ apiKey: "test-only", fetch: vi.fn().mockResolvedValue(new Response("test-only", { status: 401 })) });
    await expect(provider.repair(request())).rejects.toThrow("HTTP 401");
  });
  it("restricts endpoint, model and source paths", () => {
    for (const baseUrl of ["https://attacker.example/v1", "http://api.tokenfactory.nebius.com/v1", "https://api.tokenfactory.nebius.com/v1?key=x"]) {
      expect(() => createNebiusRepairProvider({ apiKey: "test-only", baseUrl })).toThrow();
    }
    expect(() => createNebiusRepairProvider({ apiKey: "test-only", model: "other/model" })).toThrow();
    for (const path of [".env", "../app.ts", "src/app.test.ts", "tests/app.ts", "src/vault.ts", "package.json"]) expect(isModelSourcePath(path)).toBe(false);
  });
  it("requires a key and embedded execution for the selected provider", () => {
    expect(() => loadConfig({ AI_PROVIDER: "nebius" })).toThrow("NEBIUS_API_KEY");
    expect(() => loadConfig({ AI_PROVIDER: "nebius", NEBIUS_API_KEY: "test-only", QUEUE_DRIVER: "bullmq" })).toThrow("memory");
  });
});
