import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({
  git: vi.fn(), createBranch: vi.fn(), commitFiles: vi.fn(), runTest: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => mocks.git(...args) }));
vi.mock("@ads/gitlab-integration", () => ({ createGitLabService: async () => ({ api: {
  findProject: async () => ({ path_with_namespace: "team/repo" }),
  getCommit: async () => ({ id: "source-sha" }),
  client: { paginateAll: async () => [{ type: "blob", path: "src/app.js" }] },
  getFile: async () => ({ encoding: "text", content: "exports.value = 1;" }),
  createBranch: mocks.createBranch, commitFiles: mocks.commitFiles,
} }) }));
vi.mock("@ads/execution-worker", () => ({ redactSecrets: (s: string) => s, runCommandAsTest: (...args: unknown[]) => mocks.runTest(...args) }));
import { createGitLabHost } from "../../apps/control-api/src/hosts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.clearAllMocks(); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "ads-host-test-")); dirs.push(root);
  mocks.git.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
  mocks.createBranch.mockResolvedValue(undefined);
  mocks.commitFiles.mockResolvedValue({ id: "repair-sha" });
  mocks.runTest.mockResolvedValue({ passed: false, suite: "no-suite" });
  return createGitLabHost({ workspaceRoot: root, resolveContext: async () => ({ gitlabProjectId: 42, gitlabBaseUrl: "https://gitlab.example", token: "fixture-token" }) });
}

describe("GitLab repaired-revision execution", () => {
  it("clones the project namespace, pins source, and bases successive repairs on the last commit", async () => {
    const host = setup();
    const checkout = await host.checkout("run", "feature", "requested-sha");
    expect(checkout.commitSha).toBe("source-sha");
    const commands = mocks.git.mock.calls.map((call) => call[1] as string[]);
    expect(commands.some((args) => args.includes("https://gitlab.example/team/repo.git"))).toBe(true);
    expect(commands.some((args) => args.slice(-3).join(" ") === "checkout --detach source-sha")).toBe(true);
    await host.applyPatch("run", "autofix/one", [{ path: "src/app.js", content: "exports.value = 2;" }], "fix");
    expect(mocks.createBranch).toHaveBeenLastCalledWith(42, "autofix/one", "source-sha");
    await host.applyPatch("run", "autofix/two", [{ path: "src/app.js", content: "exports.value = 3;" }], "fix");
    expect(mocks.createBranch).toHaveBeenLastCalledWith(42, "autofix/two", "repair-sha");
    await host.runTargetedTests("run", { commitSha: "repair-sha" });
    const current = mocks.git.mock.calls.map((call) => call[1] as string[]);
    expect(current.some((args) => args.slice(-3).join(" ") === "fetch origin repair-sha")).toBe(true);
    expect(current.some((args) => args.slice(-3).join(" ") === "checkout --detach repair-sha")).toBe(true);
    expect(mocks.runTest).toHaveBeenCalledWith(expect.objectContaining({ commitSha: "repair-sha" }));
  });
  it("rejects protected branches before making any commit", async () => {
    const host = setup();
    expect(await host.applyPatch("run", "main", [], "fix")).toMatchObject({ ok: false });
    expect(mocks.commitFiles).not.toHaveBeenCalled();
  });
});
