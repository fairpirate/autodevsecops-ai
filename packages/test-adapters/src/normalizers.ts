import type { TestResult } from "@ads/shared-types";
import { makeResult, type TestRunContext } from "./adapter";

/* Parsers that normalize real tool output into TestResult. */

interface VitestJsonFile {
  name?: string;
  status?: string;
  assertionResults?: Array<{ status?: string; failureMessages?: string[] }>;
  numPassingTests?: number;
  numFailingTests?: number;
  numPendingTests?: number;
  startTime?: number;
  endTime?: number;
}

/** Normalize `vitest --reporter=json --outputFile` output. */
export function parseVitestJson(
  raw: string,
  ctx: TestRunContext,
  suite: string,
  platform: TestResult["platform"],
): TestResult {
  let parsed: { testResults?: VitestJsonFile[]; numPassedTests?: number; numFailedTests?: number; success?: boolean };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return makeResult(ctx, {
      suite,
      platform,
      passed: false,
      durationMs: 0,
      failureSummary: "Unable to parse vitest JSON output",
    });
  }
  const failures = (parsed.testResults ?? [])
    .flatMap((f) => f.assertionResults ?? [])
    .filter((a) => a.status === "failed")
    .map((a) => a.failureMessages?.[0] ?? "failed")
    .slice(0, 3);
  const total = (parsed.numPassedTests ?? 0) + (parsed.numFailedTests ?? 0);
  const duration = (parsed.testResults ?? []).reduce(
    (acc, f) => acc + Math.max((f.endTime ?? 0) - (f.startTime ?? 0), 0),
    0,
  );
  return makeResult(ctx, {
    suite,
    platform,
    passed: parsed.success === true && (parsed.numFailedTests ?? 0) === 0,
    durationMs: duration,
    total,
    failed: parsed.numFailedTests ?? 0,
    skipped: (parsed.testResults ?? []).flatMap((f) => f.assertionResults ?? []).filter((a) => a.status === "pending").length,
    failureSummary: failures.length ? failures.join("\n") : undefined,
  });
}

/** Normalize Playwright JSON report (`list` reporter JSON output). */
export function parsePlaywrightJson(
  raw: string,
  ctx: TestRunContext,
  suite = "web:e2e",
): TestResult {
  let parsed: {
    stats?: { expected?: number; unexpected?: number; skipped?: number; duration?: number };
    suites?: unknown;
    errors?: Array<{ message?: string }>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return makeResult(ctx, {
      suite,
      platform: "web",
      passed: false,
      durationMs: 0,
      failureSummary: "Unable to parse Playwright JSON output",
    });
  }
  const stats = parsed.stats ?? {};
  const unexpected = stats.unexpected ?? 0;
  return makeResult(ctx, {
    suite,
    platform: "web",
    passed: unexpected === 0 && (stats.expected ?? 0) > 0,
    durationMs: stats.duration ?? 0,
    total: (stats.expected ?? 0) + unexpected,
    failed: unexpected,
    skipped: stats.skipped ?? 0,
    failureSummary:
      unexpected > 0
        ? (parsed.errors ?? []).map((e) => e.message ?? "failed").slice(0, 3).join("\n") || "Unexpected failures"
        : undefined,
  });
}

/**
 * Normalize Android/Gradle + ADB output. `logcatCrash` set when the app
 * crashed during the run (startup/crash check).
 */
export function parseAndroidBuildLog(
  raw: string,
  ctx: TestRunContext,
  suite = "mobile:android-build",
): TestResult {
  const failed = /BUILD FAILED|FAILURE: Build failed/i.test(raw);
  const testsFailed = /(\d+) failed/.exec(raw);
  const testsPassed = /(\d+) passed/.exec(raw);
  return makeResult(ctx, {
    suite,
    platform: "mobile",
    passed: !failed,
    durationMs: Number(/in ([\d.]+)s/.exec(raw)?.[1] ?? 0) * 1000,
    total: Number(testsPassed?.[1] ?? 0) + Number(testsFailed?.[1] ?? 0) || undefined,
    failed: Number(testsFailed?.[1] ?? 0) || undefined,
    failureSummary: failed ? raw.split("\n").filter((l) => /error|FAILED/i.test(l)).slice(0, 5).join("\n") : undefined,
  });
}
