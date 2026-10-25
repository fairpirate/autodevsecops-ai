import type { TestPlatform, TestResult } from "@ads/shared-types";

/** Context handed to every adapter so results are comparable. */
export interface TestRunContext {
  commitSha: string;
  artifactId?: string;
  environment: string;
  workspaceDir: string;
  timeoutMs: number;
}

/**
 * Common test adapter interface. Every adapter (unit, e2e, contract,
 * emulator, scanner...) returns the same structured result.
 */
export interface TestAdapter {
  /** Unique suite name, e.g. "server:unit", "web:e2e", "mobile:android-emulator". */
  suite: string;
  platform: TestPlatform;
  /** Optional suites that must complete before this one starts. */
  dependsOn: string[];
  run(ctx: TestRunContext): Promise<TestResult>;
}

/** Build a passing/failed TestResult from raw fields. */
export function makeResult(
  ctx: TestRunContext,
  base: Omit<TestResult, "commitSha" | "environment" | "timestamp" | "artifactId">,
): TestResult {
  return {
    ...base,
    commitSha: ctx.commitSha,
    artifactId: ctx.artifactId,
    environment: ctx.environment,
    timestamp: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Dependency-aware orchestration
 * ------------------------------------------------------------------ */

/**
 * Execute adapters in dependency levels: independent suites run in parallel,
 * suites with unresolved dependencies wait for their level. Results preserve
 * the structured TestResult contract.
 */
export async function runTestSuites(
  adapters: TestAdapter[],
  ctx: TestRunContext,
  onResult?: (r: TestResult) => void,
): Promise<TestResult[]> {
  const bySuite = new Map(adapters.map((a) => [a.suite, a]));
  // Validate dependencies exist (fail fast on misconfiguration).
  for (const a of adapters) {
    for (const dep of a.dependsOn) {
      if (!bySuite.has(dep)) throw new Error(`Suite '${a.suite}' depends on unknown suite '${dep}'`);
    }
  }
  const done = new Set<string>();
  const results: TestResult[] = [];
  const remaining = new Set(adapters.map((a) => a.suite));

  while (remaining.size > 0) {
    const ready = [...remaining].filter((s) => bySuite.get(s)!.dependsOn.every((d) => done.has(d)));
    if (ready.length === 0) {
      throw new Error(`Dependency cycle or unresolvable deps among: ${[...remaining].join(", ")}`);
    }
    const batch = ready.map((s) => bySuite.get(s)!);
    const batchResults = await Promise.all(
      batch.map((a) =>
        a.run(ctx).catch(
          (err): TestResult =>
            makeResult(ctx, {
              suite: a.suite,
              platform: a.platform,
              passed: false,
              durationMs: 0,
              failureSummary: `Adapter error: ${err instanceof Error ? err.message : String(err)}`,
            }),
        ),
      ),
    );
    for (const r of batchResults) {
      results.push(r);
      onResult?.(r);
    }
    for (const s of ready) {
      remaining.delete(s);
      done.add(s);
    }
  }
  return results;
}
