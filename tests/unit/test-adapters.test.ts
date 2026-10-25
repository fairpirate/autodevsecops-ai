import { describe, expect, it } from "vitest";
import type { TestResult } from "@ads/shared-types";
import { runTestSuites, parseVitestJson, type TestAdapter, type TestRunContext } from "@ads/test-adapters";

const ctx: TestRunContext = {
  commitSha: "abc",
  environment: "test",
  workspaceDir: "/tmp",
  timeoutMs: 1000,
};

function suite(name: string, deps: string[], order: string[]): TestAdapter {
  return {
    suite: name,
    platform: "server",
    dependsOn: deps,
    async run(c) {
      order.push(name);
      return {
        commitSha: c.commitSha,
        environment: c.environment,
        suite: name,
        platform: "server",
        passed: true,
        durationMs: 1,
        timestamp: new Date().toISOString(),
      } satisfies TestResult;
    },
  };
}

describe("runTestSuites", () => {
  it("respects dependency ordering while parallelizing independent suites", async () => {
    const order: string[] = [];
    const results = await runTestSuites(
      [suite("web:e2e", ["server:unit"], order), suite("server:unit", [], order), suite("lint", [], order)],
      ctx,
    );
    expect(results).toHaveLength(3);
    expect(order.indexOf("server:unit")).toBeLessThan(order.indexOf("web:e2e"));
  });

  it("fails fast on unknown dependencies and cycles", async () => {
    await expect(runTestSuites([suite("a", ["missing"], [])], ctx)).rejects.toThrow(/unknown suite/);
    await expect(
      runTestSuites([suite("a", ["b"], []), suite("b", ["a"], [])], ctx),
    ).rejects.toThrow(/cycle|unresolvable/);
  });

  it("turns adapter errors into failed TestResults", async () => {
    const boom: TestAdapter = {
      suite: "boom",
      platform: "server",
      dependsOn: [],
      async run() {
        throw new Error("exploded");
      },
    };
    const [r] = await runTestSuites([boom], ctx);
    expect(r.passed).toBe(false);
    expect(r.failureSummary).toContain("exploded");
  });
});

describe("parseVitestJson", () => {
  it("normalizes vitest JSON output into the structured result", () => {
    const raw = JSON.stringify({
      success: false,
      numPassedTests: 8,
      numFailedTests: 2,
      testResults: [
        {
          name: "/x/a.test.ts",
          startTime: 1000,
          endTime: 1500,
          assertionResults: [
            { status: "passed" },
            { status: "failed", failureMessages: ["expected true to be false"] },
          ],
        },
      ],
    });
    const r = parseVitestJson(raw, { ...ctx }, "server:unit", "server");
    expect(r.passed).toBe(false);
    expect(r.total).toBe(10);
    expect(r.failed).toBe(2);
    expect(r.durationMs).toBe(500);
    expect(r.failureSummary).toContain("expected true");
  });

  it("reports unparseable output as failure", () => {
    const r = parseVitestJson("garbage", ctx, "server:unit", "server");
    expect(r.passed).toBe(false);
    expect(r.failureSummary).toContain("Unable to parse");
  });
});
