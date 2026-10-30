import { spawn } from "node:child_process";
import type { TestPlatform, TestResult } from "@ads/shared-types";
import { makeResult } from "@ads/test-adapters";

/** Redact secret material from captured output before storing/returning logs. */
export function redactSecrets(text: string): string {
  return text
    .replace(/glpat-[A-Za-z0-9_\-]{10,}/g, "glpat-***")
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, "Bearer ***")
    .replace(/(PRIVATE-TOKEN|Authorization):\s*\S+/gi, "$1: ***")
    .replace(/(password|secret|token)=\S+/gi, "$1=***");
}

export interface CommandTestOptions {
  suite: string;
  platform: TestPlatform;
  command: string;
  args: string[];
  cwd: string;
  commitSha: string;
  environment: string;
  timeoutMs?: number;
  artifactId?: string;
  /** Return parsed totals from raw output when provided by the tool. */
  parse?: (stdout: string, stderr: string) => { total?: number; failed?: number; failureSummary?: string };
}

/**
 * Execute a test command as a structured TestResult.
 * - time-limited (timeout kills the process tree)
 * - output redacted (no secrets in logs)
 * - exit code + parsed output are authoritative; no AI opinions involved
 */
export function runCommandAsTest(opts: CommandTestOptions): Promise<TestResult> {
  const timeoutMs = opts.timeoutMs ?? Number(process.env.EXEC_JOB_TIMEOUT_MS ?? 600_000);
  const started = Date.now();

  return new Promise<TestResult>((resolve) => {
    let child;
    try {
      child = spawn(opts.command, opts.args, {
        cwd: opts.cwd,
        shell: process.platform === "win32",
        env: {
          ...process.env,
          CI: "1",
          NODE_ENV: "test",
          // Never pass GitLab/AI credentials into untrusted test processes.
          GITLAB_INTEGRATION_TOKEN: "",
          NEBIUS_API_KEY: "",
          CREDENTIAL_KEY_BASE64: "",
          API_KEYS: "",
          DATABASE_URL: "",
          REDIS_URL: "",
          DUO_FLOWS_ENABLED: process.env.DUO_FLOWS_ENABLED ?? "false",
        },
        windowsHide: true,
      });
    } catch (err) {
      resolve(
        makeResult(
          { commitSha: opts.commitSha, environment: opts.environment, workspaceDir: opts.cwd, timeoutMs, artifactId: opts.artifactId },
          {
            suite: opts.suite,
            platform: opts.platform,
            passed: false,
            durationMs: 0,
            failureSummary: `Failed to spawn: ${err instanceof Error ? err.message : String(err)}`,
          },
        ),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > 1_000_000) stdout = stdout.slice(-500_000);
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(
        makeResult(
          { commitSha: opts.commitSha, environment: opts.environment, workspaceDir: opts.cwd, timeoutMs, artifactId: opts.artifactId },
          {
            suite: opts.suite,
            platform: opts.platform,
            passed: false,
            durationMs: Date.now() - started,
            failureSummary: redactSecrets(err.message),
          },
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      const combined = `${stdout}\n${stderr}`;
      const parsed = opts.parse ? opts.parse(stdout, stderr) : undefined;
      const passed = code === 0 && !timedOut;
      resolve(
        makeResult(
          { commitSha: opts.commitSha, environment: opts.environment, workspaceDir: opts.cwd, timeoutMs, artifactId: opts.artifactId },
          {
            suite: opts.suite,
            platform: opts.platform,
            passed,
            durationMs,
            total: parsed?.total,
            failed: parsed?.failed,
            failureSummary: timedOut
              ? `Timed out after ${timeoutMs}ms`
              : !passed
                ? redactSecrets(
                    parsed?.failureSummary ??
                      (combined.split("\n").filter((l) => /error|fail/i.test(l)).slice(-10).join("\n").slice(0, 2000) ||
                        `exit code ${code}`),
                  )
                : undefined,
            logLink: undefined,
          },
        ),
      );
    });
  });
}
