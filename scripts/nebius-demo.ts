/** Real model + real Node tests, isolated from GitLab and production. */
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Orchestrator, createNebiusRepairProvider, type ExecutorHost, type FileMap } from "../services/orchestrator/src";
import { runCommandAsTest } from "../services/execution-worker/src";

async function main(): Promise<void> {
  if (!process.env.NEBIUS_API_KEY) throw new Error("Set NEBIUS_API_KEY in .env before running this demo");
  const workspace = await mkdtemp(join(tmpdir(), "ads-nebius-"));
  let files: FileMap = {
    "digest.js": 'const { createHash } = require("node:crypto");\nexports.digest = (value) => createHash("md5").update(value).digest("hex");\n',
    "digest.test.js": 'const { test } = require("node:test");\nconst assert = require("node:assert/strict");\nconst { createHash } = require("node:crypto");\nconst { digest } = require("./digest");\ntest("digest uses SHA-256 and preserves input behavior", () => {\n  for (const input of ["hello", "", "世界"]) assert.equal(digest(input), createHash("sha256").update(input).digest("hex"));\n});\n',
  };
  const sha = () => createHash("sha256").update(JSON.stringify(files)).digest("hex");
  const tests = async (suite: string, commitSha: string) => [await runCommandAsTest({
    suite, platform: "server", command: process.execPath, args: ["--test", "digest.test.js"],
    cwd: workspace, commitSha, environment: "isolated-local-demo", timeoutMs: 15_000,
  })];
  try {
    for (const [path, content] of Object.entries(files)) await writeFile(join(workspace, path), content);
    const baseline = await tests("baseline:sha256", sha());
    if (baseline[0].passed) throw new Error("Baseline unexpectedly passed; no defect demonstrated");
    console.log(JSON.stringify({ event: "baseline", passed: false, suite: baseline[0].suite }));
    const host: ExecutorHost = {
      async checkout() { return { ok: true, files: { ...files }, commitSha: sha() }; },
      async applyPatch(_id, branch, updates) {
        if (!branch.startsWith("autofix/")) throw new Error("Invalid repair branch");
        for (const update of updates) {
          if (update.path !== "digest.js") throw new Error("Demo only allows digest.js repairs");
          await writeFile(join(workspace, update.path), update.content);
          files[update.path] = await readFile(join(workspace, update.path), "utf8");
        }
        return { ok: true, commitSha: sha() };
      },
      runTargetedTests: (_id, ctx) => tests("server:unit", ctx.commitSha),
      runFullRegression: (_id, ctx) => tests("server:unit", ctx.commitSha),
      async runSecurityScan() { return { passed: false, findings: [], tool: "unused: orchestrator rescans" }; },
    };
    const orch = new Orchestrator({ host, policy: { requiredSuites: ["server:unit"] }, aiRepair: createNebiusRepairProvider({
      apiKey: process.env.NEBIUS_API_KEY, model: process.env.NEBIUS_MODEL,
      baseUrl: process.env.NEBIUS_BASE_URL,
    }), events: { emit(_id, event, payload) {
      if (["repair_generated", "test_result", "verification", "completed", "quality_gate", "error"].includes(event)) {
        console.log(JSON.stringify({ event, ...payload }));
      }
    } } });
    const run = orch.createRun({ projectId: "local-nebius-demo", gitlabProjectId: 0, ref: "local", commitSha: sha(), budget: { maxIterations: 1 } });
    await orch.run(run.id);
    console.log(JSON.stringify({ event: "metrics", ...orch.getSession(run.id)!.ledger.metrics() }));
    if (run.state !== "READY_FOR_BUILD") throw new Error(`Demo ended ${run.state}; see evidence above`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
main().catch(() => { console.error("Nebius demo failed; check configuration and emitted evidence. No success claimed."); process.exitCode = 1; });
