import type { Server } from "node:http";
import request from "supertest";
import { buildApp } from "../../apps/control-api/src/app";
import { loadConfig } from "../../apps/control-api/src/config";
import { RunEventBus } from "../../apps/control-api/src/events";
import { createMemoryStore } from "../../apps/control-api/src/store/memory";
import type { Store } from "../../apps/control-api/src/store/types";
import { TokenVault } from "@ads/gitlab-integration";
import { Orchestrator, type ExecutorHost, type FileMap } from "@ads/orchestrator";
import type { TestResult } from "@ads/shared-types";

export const ADMIN_KEY = "test-admin-key";
export const ENG_KEY = "test-eng-key";
export const VIEWER_KEY = "test-viewer-key";
export const WEBHOOK_SECRET = "test-webhook-secret";
export const SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

export const REPO: FileMap = {
  "src/main.ts": [
    "export function go() {",
    "  try {",
    "    work();",
    "  } catch (e) {}",
    "}",
    "export const render = (h: string) => {",
    "  document.body.innerHTML = h;",
    "};",
    "export const weak = (d: string) => createHash('md5').update(d).digest('hex');",
  ].join("\n"),
  "src/main.test.ts": "test('ok', () => {});",
};

export function pass(suite: string, platform: TestResult["platform"] = "server"): TestResult {
  return {
    commitSha: SHA,
    environment: "local",
    suite,
    platform,
    passed: true,
    durationMs: 3,
    total: 5,
    failed: 0,
    timestamp: new Date().toISOString(),
  };
}

export const fakeHost: ExecutorHost = {
  async checkout() {
    return { ok: true, files: { ...REPO }, commitSha: SHA };
  },
  async runTargetedTests() {
    return [pass("server:unit")];
  },
  async runFullRegression() {
    return [pass("server:unit"), pass("web:unit", "web")];
  },
  async runSecurityScan() {
    return { passed: true, findings: [], tool: "fake" };
  },
  async applyPatch() {
    return { ok: true, commitSha: "patch1" };
  },
};

/** Mock GitLab REST for project connect + commit listing. Delegates non-GitLab URLs to the original fetch. */
export function installFetchMock() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes("gitlab.example") && url.includes("/api/v4/user")) {
      return new Response(JSON.stringify({ id: 7, username: "svc" }), { status: 200 });
    }
    if (url.includes("gitlab.example") && url.includes("/api/v4/projects/")) {
      if (url.includes("/repository/commits")) {
        return new Response(
          JSON.stringify([{ id: SHA, short_id: SHA.slice(0, 8), title: "feat", author_name: "a", created_at: new Date().toISOString(), parent_ids: [] }]),
          { status: 200, headers: { "x-total": "1" } },
        );
      }
      return new Response(
        JSON.stringify({
          id: 123,
          name: "demo",
          path_with_namespace: "group/demo",
          default_branch: "main",
          web_url: "https://gitlab.example/group/demo",
        }),
        { status: 200 },
      );
    }
    // Local API + everything else: use the real fetch.
    return original(input as never, init as never);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
export interface Harness {
  base: string;
  store: Store;
  vault: TokenVault;
  start(): Promise<void>;
  stop(): Promise<void>;
  auth(key?: string): { Authorization: string };
  connectProject(): Promise<string>;
  waitForRun(runId: string, states: string[], timeoutMs?: number): Promise<{ state: string; id: string }>;
  createCompletedRun(): Promise<string>;
}

export function createHarness(): Harness {
  const config = loadConfig({
    NODE_ENV: "test",
    API_KEYS: `${ADMIN_KEY}:admin,${ENG_KEY}:engineer,${VIEWER_KEY}:viewer`,
    GITLAB_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STORE: "memory",
    QUEUE_DRIVER: "memory",
  } as NodeJS.ProcessEnv);

  const store = createMemoryStore();
  const bus = new RunEventBus(store);
  const vault = new TokenVault(config.CREDENTIAL_KEY_BASE64);
  const orchestrator = new Orchestrator({
    host: fakeHost,
    // Mirror server.ts: persist test_result events so GET /runs/:id/test-results works.
    events: {
      emit: (runId: string, type: string, payload: Record<string, unknown>) => {
        if (type === "test_result") {
          void store.testResults
            .createMany(runId, [payload as never])
            .catch((err) => console.error("[harness] test result persist failed:", err));
        }
        bus.sink().emit(runId, type, payload);
      },
    },
    persist: (run, issues) => store.runs.update(run, issues),
    isCancelled: async (id) => (await store.runs.get(id))?.run.state === "CANCELLED",
  });
  const app = buildApp({ config, store, bus, orchestrator, vault });
  let server: Server | undefined;
  let base = "";
  let restore: (() => void) | undefined;

  const harness: Harness = {
    base: "",
    store,
    vault,
    auth: (key = ADMIN_KEY) => ({ Authorization: `Bearer ${key}` }),
    async start() {
      restore = installFetchMock();
      await new Promise<void>((resolve) => {
        server = app.listen(0, resolve);
      });
      const addr = server!.address();
      base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
      harness.base = base;
    },
    async stop() {
      restore?.();
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    },
    async connectProject() {
      const res = await request(base)
        .post("/api/v1/projects/connect")
        .set("Authorization", `Bearer ${ADMIN_KEY}`)
        .send({ gitlabBaseUrl: "https://gitlab.example", token: "fixture-gitlab-token", gitlabProjectId: 123 });
      if (res.status !== 201) throw new Error(`connect failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.project.id as string;
    },
    async waitForRun(runId, states, timeoutMs = 10_000) {
      const startTs = Date.now();
      for (;;) {
        const row = await store.runs.get(runId);
        if (row && states.includes(row.run.state)) return { state: row.run.state, id: runId };
        if (Date.now() - startTs > timeoutMs) {
          throw new Error(`run ${runId} did not reach ${states.join("/")} (last: ${row?.run.state})`);
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    async createCompletedRun() {
      const projectId = await this.connectProject();
      const created = await request(base)
        .post("/api/v1/runs")
        .set("Authorization", `Bearer ${ENG_KEY}`)
        .send({ projectId, ref: "main", commitSha: SHA });
      if (created.status !== 202) throw new Error(`create run failed: ${created.status}`);
      const done = await this.waitForRun(created.body.run.id, ["READY_FOR_BUILD", "BLOCKED", "FAILED"]);
      if (done.state !== "READY_FOR_BUILD") throw new Error(`run ended ${done.state}`);
      return done.id;
    },
  };
  return harness;
}

