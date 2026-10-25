import path from "node:path";
import type { TestResult } from "@ads/shared-types";
import { runCommandAsTest, redactSecrets } from "./run-command";

export * from "./run-command";

export interface ExecJob {
  runId: string;
  commitSha: string;
  environment: string;
  workspaceDir?: string;
  artifactId?: string;
  suites: Array<{
    suite: string;
    platform: TestResult["platform"];
    command: string;
    args: string[];
    timeoutMs?: number;
  }>;
}

/** Execute all suites of an exec job sequentially (job-level parallelism via queue concurrency). */
export async function executeJob(job: ExecJob): Promise<TestResult[]> {
  const cwd = job.workspaceDir ?? path.resolve(process.env.EXEC_WORK_DIR ?? "./.exec-workspace");
  const results: TestResult[] = [];
  for (const s of job.suites) {
    const result = await runCommandAsTest({
      suite: s.suite,
      platform: s.platform,
      command: s.command,
      args: s.args,
      cwd,
      commitSha: job.commitSha,
      environment: job.environment,
      timeoutMs: s.timeoutMs,
      artifactId: job.artifactId,
      parse: (out, err) => {
        const text = `${out}\n${err}`;
        const failed = /(\d+) failed/.exec(text);
        const passed = /(\d+) passed/.exec(text);
        return {
          total: failed || passed ? Number(failed?.[1] ?? 0) + Number(passed?.[1] ?? 0) : undefined,
          failed: Number(failed?.[1] ?? 0) || undefined,
          failureSummary: failed ? redactSecrets(text.split("\n").filter((l) => /fail/i.test(l)).slice(-5).join("\n")) : undefined,
        };
      },
    });
    results.push(result);
  }
  return results;
}
