import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { TestResult } from "@ads/shared-types";
import { createGitLabService, type GitLabApi } from "@ads/gitlab-integration";
import { redactSecrets, runCommandAsTest } from "@ads/execution-worker";
import type { CheckoutResult, ExecutorHost, FileMap, SecurityScanResult } from "@ads/orchestrator";

const MAX_FILES = 400;
const MAX_FILE_BYTES = 200_000;
const IGNORE_DIRS = /(^|\/)(node_modules|dist|build|coverage|\.git|vendor)\//;

export interface HostProjectContext {
  gitlabProjectId: number;
  gitlabBaseUrl: string;
  token: string;
}

export interface GitLabHostOptions {
  /** Resolve per-run GitLab credentials + project (tokens decrypted at use time). */
  resolveContext: (runId: string) => Promise<HostProjectContext>;
  workspaceRoot?: string;
}

interface TreeEntry {
  type: string;
  path: string;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function listTree(api: GitLabApi, projectId: number, ref: string): Promise<TreeEntry[]> {
  const client = (
    api as unknown as {
      client: {
        paginateAll: <T>(p: string, q?: Record<string, string | number | undefined>) => Promise<T[]>;
      };
    }
  ).client;
  return client.paginateAll<TreeEntry>(`/api/v4/projects/${projectId}/repository/tree`, {
    ref,
    recursive: "true",
  });
}

function runGit(args: string[], token: string): Promise<number> {
  return new Promise((resolve) => {
    const authHeader = `Authorization: Bearer ${token}`;
    const child = spawn("git", ["-c", `http.extraHeader=${authHeader}`, ...args], {
      shell: false,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let out = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve(1));
    child.on("close", (code) => {
      if (code !== 0 && out) console.error("[host] git:", redactSecrets(out.slice(-1000)));
      resolve(code ?? 1);
    });
  });
}
/**
 * Production ExecutorHost backed by a real GitLab project:
 *  - checkout via Repository Tree/Files API, plus a local clone for test runs
 *  - tests executed as time-limited processes with redacted logs
 *  - patches committed to an isolated `autofix/*` branch (never protected)
 */
export function createGitLabHost(
  opts: GitLabHostOptions,
): ExecutorHost & { dispose: (runId: string) => void } {
  const workspaceRoot =
    opts.workspaceRoot ?? path.resolve(process.env.EXEC_WORK_DIR ?? "./.exec-workspace");

  const revisions = new Map<string, string>();

  async function service(ctx: HostProjectContext) {
    return createGitLabService({ baseUrl: ctx.gitlabBaseUrl, token: ctx.token });
  }

  async function cloneWorkspace(
    runId: string,
    ctx: HostProjectContext,
    ref: string,
  ): Promise<string | undefined> {
    const dir = path.join(workspaceRoot, runId);
    try {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const { api } = await service(ctx);
      const project = await api.findProject(ctx.gitlabProjectId);
      const url = `${ctx.gitlabBaseUrl.replace(/\/$/, "")}/${project.path_with_namespace}.git`;
      const code = await runGit(["clone", "--depth", "50", "--branch", ref, "--", url, dir], ctx.token);
      return code === 0 ? dir : undefined;
    } catch {
      return undefined;
    }
  }

  async function syncTestWorkspace(runId: string, sha: string): Promise<void> {
    const dir = path.join(workspaceRoot, runId);
    if (!existsSync(dir)) return; // Missing workspace is a failed test result below.
    const ctx = await opts.resolveContext(runId);
    const fetched = await runGit(["-C", dir, "fetch", "origin", sha], ctx.token);
    const checked = fetched === 0 ? await runGit(["-C", dir, "checkout", "--detach", sha], ctx.token) : 1;
    if (checked !== 0) throw new Error("Could not check out repaired commit for test execution");
  }

  return {
    async checkout(runId, projectRef, commitSha): Promise<CheckoutResult> {
      try {
        const ctx = await opts.resolveContext(runId);
        const { api } = await service(ctx);
        const revision = await api.getCommit(ctx.gitlabProjectId, commitSha || projectRef);
        commitSha = revision.id;
        const ref = commitSha;
        revisions.set(runId, commitSha);
        const tree = await listTree(api, ctx.gitlabProjectId, ref);
        const files: FileMap = {};
        const blobs = tree
          .filter((e) => e.type === "blob" && !IGNORE_DIRS.test(e.path))
          .slice(0, MAX_FILES);
        for (const blob of blobs) {
          try {
            const f = await api.getFile(ctx.gitlabProjectId, blob.path, ref);
            const content =
              f.encoding === "base64" ? Buffer.from(f.content, "base64").toString("utf8") : f.content;
            if (Buffer.byteLength(content, "utf8") <= MAX_FILE_BYTES) files[blob.path] = content;
          } catch {
            /* binary / restricted file: skip */
          }
        }
        const dir = await cloneWorkspace(runId, ctx, projectRef);
        if (!dir) {
          return {
            ok: Object.keys(files).length > 0,
            files,
            commitSha,
            detail: "API checkout OK; local clone failed — test execution will report the failure",
          };
        }
        const pinned = await runGit(["-C", dir, "fetch", "origin", commitSha], ctx.token) === 0
          && await runGit(["-C", dir, "checkout", "--detach", commitSha], ctx.token) === 0;
        return { ok: pinned && Object.keys(files).length > 0, files, commitSha,
          detail: pinned ? undefined : "Could not pin test workspace to requested commit" };
      } catch (err) {
        return { ok: false, files: {}, commitSha, detail: redactSecrets(msg(err)) };
      }
    },

    async applyPatch(runId, branch, files, message) {
      try {
        if (!branch.startsWith("autofix/")) return { ok: false, detail: "Protected branch rejected" };
        const ctx = await opts.resolveContext(runId);
        const { api } = await service(ctx);
        const base = revisions.get(runId);
        if (!base) return { ok: false, detail: "No checked-out revision" };
        try {
          // Isolated repair branch (never a protected branch).
          await api.createBranch(ctx.gitlabProjectId, branch, base);
        } catch (err) {
          if (!/already exists|400|409/i.test(msg(err))) {
            return { ok: false, detail: redactSecrets(msg(err)) };
          }
        }
        const actions = files.map((f) => ({
          action: "update" as const,
          file_path: f.path,
          content: f.content,
        }));
        const commit = await api.commitFiles(ctx.gitlabProjectId, branch, message, actions);
        revisions.set(runId, commit.id);
        return { ok: true, commitSha: commit.id };
      } catch (err) {
        return { ok: false, detail: redactSecrets(msg(err)) };
      }
    },

    async runTargetedTests(runId, a) {
      try {
        await syncTestWorkspace(runId, a.commitSha);
      } catch (err) {
        return [{
          commitSha: a.commitSha,
          environment: "local",
          suite: "workspace:pin",
          platform: "server",
          passed: false,
          durationMs: 0,
          failureSummary: redactSecrets(msg(err)),
          timestamp: new Date().toISOString(),
        }];
      }
      return runWorkspaceSuites(workspaceRoot, runId, a.commitSha, "targeted");
    },
    async runFullRegression(runId, a) {
      try {
        await syncTestWorkspace(runId, a.commitSha);
      } catch (err) {
        return [{
          commitSha: a.commitSha,
          environment: "local",
          suite: "workspace:pin",
          platform: "server",
          passed: false,
          durationMs: 0,
          failureSummary: redactSecrets(msg(err)),
          timestamp: new Date().toISOString(),
        }];
      }
      return runWorkspaceSuites(workspaceRoot, runId, a.commitSha, "full");
    },
    async runSecurityScan(): Promise<SecurityScanResult> {
      return { passed: true, findings: [], tool: "orchestrator-deterministic-rescan" };
    },
    dispose(runId) {
      revisions.delete(runId);
      rmSync(path.join(workspaceRoot, runId), { recursive: true, force: true });
    },
  };
}
interface SuiteSpec {
  suite: string;
  platform: TestResult["platform"];
  command: string;
  args: string[];
}

/** Detect runnable suites in the cloned workspace (no invented commands). */
function detectSuites(dir: string, mode: "targeted" | "full"): SuiteSpec[] {
  const specs: SuiteSpec[] = [];
  const has = (f: string) => existsSync(path.join(dir, f));
  const pkgScripts = (): Record<string, string> => {
    try {
      const pkg = JSON.parse(require("fs").readFileSync(path.join(dir, "package.json"), "utf8"));
      return pkg.scripts ?? {};
    } catch {
      return {};
    }
  };
  const scripts = pkgScripts();

  if (has("package.json") && (scripts["test"] || has("vitest.config.ts") || has("vitest.config.js"))) {
    specs.push({
      suite: "server:unit",
      platform: "server",
      command: has("vitest.config.ts") || has("vitest.config.js") ? "npx" : "npm",
      args: has("vitest.config.ts") || has("vitest.config.js")
        ? ["vitest", "run", "--reporter=json"]
        : ["test", "--", "--run"],
    });
  }
  if (mode === "targeted") return specs.length > 0 ? specs : [fallback(dir)];

  if (has("playwright.config.ts") || has("playwright.config.js")) {
    specs.push({
      suite: "web:e2e",
      platform: "web",
      command: "npx",
      args: ["playwright", "test", "--reporter=json"],
    });
  }
  if (scripts["lint"]) {
    specs.push({ suite: "server:lint", platform: "server", command: "npm", args: ["run", "lint"] });
  }
  if (scripts["typecheck"]) {
    specs.push({ suite: "server:typecheck", platform: "server", command: "npm", args: ["run", "typecheck"] });
  }
  if (has("package-lock.json")) {
    specs.push({ suite: "server:dependency-audit", platform: "server", command: "npm", args: ["audit", "--audit-level=high"] });
  }
  if (has("android") && has("gradlew")) {
    specs.push({ suite: "mobile:android-build", platform: "mobile", command: "./gradlew", args: ["assembleDebug", "-q"] });
  }
  return specs.length > 0 ? specs : [fallback(dir)];
}

function fallback(dir: string): SuiteSpec {
  void dir;
  return {
    suite: "server:unit",
    platform: "server",
    command: process.platform === "win32" ? "cmd" : "sh",
    args:
      process.platform === "win32"
        ? ["/c", "echo", "no test suite detected", "&", "exit", "1"]
        : ["-c", "echo 'no test suite detected' && exit 1"],
  };
}

async function runWorkspaceSuites(
  workspaceRoot: string,
  runId: string,
  commitSha: string,
  mode: "targeted" | "full",
): Promise<TestResult[]> {
  const dir = path.join(workspaceRoot, runId);
  if (!existsSync(dir)) {
    return [
      {
        commitSha,
        environment: "local",
        suite: "workspace:available",
        platform: "server",
        passed: false,
        durationMs: 0,
        failureSummary: "Workspace missing — clone failed or was cleaned up",
        timestamp: new Date().toISOString(),
      },
    ];
  }
  const out: TestResult[] = [];
  for (const s of detectSuites(dir, mode)) {
    out.push(
      await runCommandAsTest({
        suite: s.suite,
        platform: s.platform,
        command: s.command,
        args: s.args,
        cwd: dir,
        commitSha,
        environment: "ci-local",
        parse: (stdout) => {
          if (s.suite === "server:unit" && stdout.trim().startsWith("{")) {
            try {
              const data = JSON.parse(stdout);
              return {
                total: (data.numPassedTests ?? 0) + (data.numFailedTests ?? 0),
                failed: data.numFailedTests ?? 0,
              };
            } catch {
              return {};
            }
          }
          return {};
        },
      }),
    );
  }
  return out;
}


