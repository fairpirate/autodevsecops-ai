import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { executeJob, type ExecJob } from "./index";

/**
 * Execution worker entrypoint.
 * Consumes `exec-jobs` from BullMQ when QUEUE_DRIVER=bullmq; otherwise it
 * idles (the control API executes jobs in-process with the memory driver).
 */
async function main(): Promise<void> {
  const driver = process.env.QUEUE_DRIVER ?? "memory";
  if (driver !== "bullmq") {
    console.log("[execution-worker] QUEUE_DRIVER=memory — nothing to consume; idle.");
    return;
  }
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<ExecJob>("exec-jobs", { connection });

  const worker = new Worker<ExecJob>(
    "exec-jobs",
    async (job) => {
      console.log(`[execution-worker] running job ${job.id} for run ${job.data.runId}`);
      const results = await executeJob(job.data);
      return { results };
    },
    { connection, concurrency: Number(process.env.EXEC_CONCURRENCY ?? 2) },
  );

  worker.on("completed", (job) => console.log(`[execution-worker] job ${job.id} completed`));
  worker.on("failed", (job, err) => console.error(`[execution-worker] job ${job?.id} failed:`, err.message));

  const shutdown = async () => {
    await worker.close();
    await queue.close();
    await connection.quit();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[execution-worker] started, waiting for exec-jobs…");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
