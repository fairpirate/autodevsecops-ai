import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { Orchestrator } from "./orchestrator";
import type { IssueRecord, RunRecord } from "@ads/shared-types";

/**
 * Orchestrator service entrypoint (QUEUE_DRIVER=bullmq mode).
 * Consumes `run-steps` jobs enqueued by the control API. State and issues are
 * persisted through the Prisma store; live events are published to Redis.
 */
interface RunStepJob {
  runId: string;
}

interface MinimalRunRow {
  state: string;
  iteration: number;
  issues?: unknown;
}

async function main(): Promise<void> {
  const driver = process.env.QUEUE_DRIVER ?? "memory";
  if (driver !== "bullmq") {
    console.log("[orchestrator] QUEUE_DRIVER=memory — runs execute in-process; idle.");
    return;
  }
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<RunStepJob>("run-steps", { connection });

  // Prisma is only loaded in bullmq mode; generated client required (`npm run db:generate`).
  const { PrismaClient } = require("@prisma/client") as {
    PrismaClient: new () => Record<string, any>;
  };
  const prisma = new PrismaClient();

  const orchestrator = new Orchestrator({
    host: {
      async checkout() {
        throw new Error(
          "Standalone orchestrator host is not configured. Run with QUEUE_DRIVER=memory (embedded mode) or wire a GitLab-backed ExecutorHost.",
        );
      },
      async runTargetedTests() {
        return [];
      },
      async runFullRegression() {
        return [];
      },
      async runSecurityScan() {
        return { passed: true, findings: [], tool: "none" };
      },
      async applyPatch() {
        return { ok: false, detail: "not wired" };
      },
    },
    events: {
      emit(runId, type, payload) {
        void prisma.eventLog
          .create({ data: { runId, type, at: new Date().toISOString(), payload } })
          .catch((e: Error) => console.error("[orchestrator] persist event failed:", e.message));
        connection
          .publish(`run-events:${runId}`, JSON.stringify({ type, payload, at: new Date().toISOString() }))
          .catch(() => undefined);
      },
    },
    persist: async (run: RunRecord, issues: IssueRecord[]) => {
      await prisma.run.update({
        where: { id: run.id },
        data: { state: run.state, iteration: run.iteration, issues, updatedAt: new Date() },
      });
    },
  });

  const worker = new Worker<RunStepJob>(
    "run-steps",
    async (job) => {
      const row = (await prisma.run.findUnique({ where: { id: job.data.runId } })) as MinimalRunRow | null;
      if (!row) throw new Error(`run ${job.data.runId} not found`);
      // Rehydrate full run record via JSON columns stored by the control API.
      const full = (await prisma.run.findUnique({ where: { id: job.data.runId } })) as unknown as RunRecord;
      orchestrator.hydrate(full, (row.issues as IssueRecord[]) ?? []);
      await orchestrator.run(full.id);
      return { state: full.state };
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => console.error(`[orchestrator] job ${job?.id} failed:`, err.message));
  const shutdown = async () => {
    await worker.close();
    await queue.close();
    await connection.quit();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  console.log("[orchestrator] started, waiting for run-steps…");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
