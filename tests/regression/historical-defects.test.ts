import { describe, expect, it } from "vitest";
import { Orchestrator, type ExecutorHost, type FileMap, type RunEventSink } from "@ads/orchestrator";
import type { TestResult } from "@ads/shared-types";

/**
 * Regression suite: previously-fixed defect classes must stay fixed.
 * Each case replays the exact fixture that produced a historical failure and
 * asserts the loop still reaches READY_FOR_BUILD with the rule cleared.
 */

const HISTORY: Array<{ name: string; files: FileMap; absentAfter: string[] }> = [
  {
    name: "AVS101 empty catch is repaired (not just re-reported)",
    files: {
      "src/a.ts": "export function f() {\n  try {\n    g();\n  } catch (e) {}\n}",
      "src/a.test.ts": "test('x', () => {});",
    },
    absentAfter: ["catch (e) {}"],
  },
  {
    name: "AVSS03 innerHTML assignment is neutralized",
    files: {
      "src/b.ts": "export const v = (h: string) => {\n  document.body.innerHTML = h;\n};",
      "src/b.test.ts": "test('x', () => {});",
    },
    absentAfter: [".innerHTML ="],
  },
  {
    name: "AVSS05 weak hash is upgraded to sha256",
    files: {
      "src/c.ts": "export function d(x: string) {\n  return createHash('md5').update(x).digest('hex');\n}",
      "src/c.test.ts": "test('x', () => {});",
    },
    absentAfter: ["md5"],
  },
];

function hostFor(files: FileMap): ExecutorHost {
  const pass = (suite: string): TestResult => ({
    commitSha: "sha-regression",
    environment: "local",
    suite,
    platform: "server",
    passed: true,
    durationMs: 2,
    total: 4,
    failed: 0,
    timestamp: new Date().toISOString(),
  });
  return {
    async checkout() {
      return { ok: true, files: { ...files }, commitSha: "sha-regression" };
    },
    async runTargetedTests() {
      return [pass("server:unit")];
    },
    async runFullRegression() {
      return [pass("server:unit"), pass("web:unit")];
    },
    async runSecurityScan() {
      return { passed: true, findings: [], tool: "regression" };
    },
    async applyPatch() {
      return { ok: true, commitSha: "sha-patch" };
    },
  };
}

const sink: RunEventSink = { emit: () => undefined };

describe("regression: historical defect classes stay fixed", () => {
  for (const h of HISTORY) {
    it(h.name, async () => {
      const orch = new Orchestrator({ host: hostFor(h.files), events: sink });
      const run = orch.createRun({
        projectId: "p1",
        gitlabProjectId: 1,
        ref: "main",
        commitSha: "sha-regression",
      });
      const finished = await orch.run(run.id);
      expect(finished.state).toBe("READY_FOR_BUILD");
      const session = orch.getSession(run.id)!;
      for (const needle of h.absentAfter) {
        const haystack = Object.values(session.files).join("\n");
        expect(haystack).not.toContain(needle);
      }
      // Independent verification evidence exists for every fixed issue.
      const fixed = session.ledger.list().filter((i) => i.state === "verified_fixed");
      expect(fixed.length).toBeGreaterThan(0);
      for (const i of fixed) {
        expect(i.verification?.reviewer).toBe("independent-verification-agent");
      }
    });
  }
});
