import { loadConfig } from "./config";
import { buildApp } from "./app";
import { RunEventBus } from "./events";
import { TokenVault } from "@ads/gitlab-integration";
import { Orchestrator, type ExecutorHost } from "@ads/orchestrator";
import { createMemoryStore } from "./store/memory";
import type { Store } from "./store/types";
import { createGitLabHost } from "./hosts";

async function createStore(config: ReturnType<typeof loadConfig>): Promise<Store> {
  if (config.STORE === "prisma") {
    const { PrismaClient } = require("@prisma/client") as { PrismaClient: new () => Record<string, any> };
    const { createPrismaStore } = await import("./store/prisma-store");
    const prisma = new PrismaClient();
    await prisma.$connect();
    console.log("[server] store: postgres (prisma)");
    return createPrismaStore(prisma);
  }
  console.log("[server] store: in-memory (STORE=memory — set STORE=prisma + DATABASE_URL for PostgreSQL)");
  return createMemoryStore();
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await createStore(config);
  const bus = new RunEventBus(store);
  const vault = new TokenVault(config.CREDENTIAL_KEY_BASE64);

  const host: ExecutorHost = createGitLabHost({
    resolveContext: async (runId) => {
      const row = await store.runs.get(runId);
      if (!row) throw new Error(`run ${runId} not found`);
      const project = await store.projects.get(row.run.projectId);
      if (!project) throw new Error(`project ${row.run.projectId} not found`);
      return {
        gitlabProjectId: project.gitlabProjectId,
        gitlabBaseUrl: project.gitlabBaseUrl,
        token: vault.decrypt(project.tokenEncrypted),
      };
    },
  });

  const orchestrator = new Orchestrator({
    host,
    events: {
      emit: (runId, type, payload) => {
        // Persist test results alongside events; fan out to SSE subscribers.
        if (type === "test_result") {
          void store.testResults.createMany(runId, [payload as never]).catch(() => undefined);
        }
        void bus.publish(runId, type, payload).catch((err) =>
          console.error("[events] publish failed:", err instanceof Error ? err.message : err),
        );
      },
    },
    persist: async (run, issues) => {
      await store.runs.update(run, issues);
    },
    isCancelled: async (runId) => {
      const row = await store.runs.get(runId);
      return row?.run.state === "CANCELLED";
    },
  });

  const enqueueRun: ((runId: string) => Promise<void>) | undefined =
    config.QUEUE_DRIVER === "bullmq"
      ? async (runId: string) => {
          const { Queue } = await import("bullmq");
          const IORedis = (await import("ioredis")).default;
          const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
          const queue = new Queue("run-steps", { connection });
          await queue.add("run", { runId });
          // Connection stays referenced for the process lifetime (queue is lazy).
        }
      : undefined;

  const app = buildApp({ config, store, bus, orchestrator, vault, enqueueRun });

  const server = app.listen(config.CONTROL_API_PORT, () => {
    console.log(`[server] control-api listening on http://localhost:${config.CONTROL_API_PORT}`);
    console.log(`[server] queue driver: ${config.QUEUE_DRIVER}, duo flows: ${config.duoFlowsEnabled ? "enabled" : "disabled (deterministic analyzers only)"}`);
  });

  const shutdown = async () => {
    console.log("[server] shutting down…");
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[server] fatal:", err);
    process.exit(1);
  });
}

export { buildApp, loadConfig, RunEventBus, TokenVault };
