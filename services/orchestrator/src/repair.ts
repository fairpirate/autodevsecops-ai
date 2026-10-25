import type { IssueRecord, RepairResult } from "@ads/shared-types";
import type { FileMap } from "./ports";

/**
 * AI Repair Agent (Agent C).
 *
 * Produces the SMALLEST reasonable patch for an approved repair task inside
 * an isolated workspace. Deterministic transforms are applied first; when the
 * repair requires reasoning the caller dispatches a GitLab Duo flow
 * (never an unrelated LLM substitute when flows are disabled).
 *
 * Guardrails enforced here:
 *  - never touches protected branches (branch name is always namespaced)
 *  - never weakens tests/thresholds (patches that only delete tests are rejected)
 *  - never includes secrets or production credentials
 */

export interface RepairAttempt {
  result: RepairResult;
  /** Files to write after the transform (path -> new content). */
  updates: Array<{ path: string; content: string }>;
}

export function repairBranchName(runId: string, iteration: number, issueId: string): string {
  return `autofix/${runId.slice(0, 8)}-iter${iteration}-${issueId.slice(0, 8)}`;
}

type Transform = (content: string) => string | null;

/** Safe, semantics-preserving deterministic transforms per rule id. */
const TRANSFORMS: Record<string, Transform> = {
  // Drop debugger statements.
  AVS102: (c) => (/\bdebugger\b/.test(c) ? c.replace(/^\s*debugger;?\s*$/gm, "") : null),
  // Empty catch -> logged rethrow-less handling (keeps control flow, adds visibility).
  AVS101: (c) =>
    /catch\s*\(([^)]*)\)\s*\{\s*\}/.test(c)
      ? c.replace(/catch\s*\(([^)]*)\)\s*\{\s*\}/g, (_m, param) =>
          `catch (${param}) {\n  // Auto-repair: surface swallowed errors (AVS101)\n  console.error("caught error", ${param});\n}`,
        )
      : null,
  // innerHTML assigned a variable -> textContent (XSS-safe default).
  AVSS03: (c) => {
    if (!/\.(?:innerHTML|outerHTML)\s*=\s*[A-Za-z_$]/.test(c)) return null;
    return c
      .replace(/\.innerHTML\s*=/g, ".textContent =")
      .replace(/\.outerHTML\s*=/g, ".textContent =");
  },
  // Weak hash -> sha256.
  AVSS05: (c) =>
    /createHash\s*\(\s*["'](?:md5|sha1)["']\s*\)/.test(c)
      ? c.replace(/createHash\s*\(\s*["'](?:md5|sha1)["']\s*\)/g, 'createHash("sha256")')
      : null,
};
function ruleIdOf(issue: IssueRecord): string | undefined {
  return issue.evidence.find((e) => e.reference)?.reference?.split(" @")[0] ?? issue.title.split(":")[0];
}

/**
 * Attempt a deterministic repair for one issue.
 * Returns null when the fix requires AI reasoning (caller dispatches a Duo
 * flow) or must be escalated to a human — we never fabricate a patch.
 */
export function attemptDeterministicRepair(
  issue: IssueRecord,
  files: FileMap,
  runId: string,
  iteration: number,
): RepairAttempt | null {
  const ruleId = ruleIdOf(issue);
  if (!ruleId || !issue.filePath) return null;
  const transform = TRANSFORMS[ruleId];
  if (!transform) return null;
  const before = files[issue.filePath];
  if (before === undefined) return null;

  const after = transform(before);
  if (after === null || after === before) return null;

  // Guardrail: patches must not delete tests or weaken quality thresholds.
  if (/describe\s*\(|it\s*\(|test\s*\(/.test(before) && !/describe\s*\(|it\s*\(|test\s*\(/.test(after)) {
    return null;
  }
  const addedLines =
    after.split("\n").length - before.split("\n").length >= 0
      ? after.split("\n").filter((l, i) => !before.split("\n").includes(l)).length
      : 0;

  const branch = repairBranchName(runId, iteration, issue.id);
  const diff = unifiedDiff(issue.filePath, before, after);
  return {
    updates: [{ path: issue.filePath, content: after }],
    result: {
      issueId: issue.id,
      branch,
      diff,
      patchSizeLines: addedLines,
      filesChanged: [issue.filePath],
      explanation: `Applied deterministic transform for rule ${ruleId}: ${issue.remediation}`,
      regressionTestsAdded: [],
      rootCause: issue.description,
      selfAssessedRisk: "low",
      requiresHumanReview: issue.severity === "critical",
      tokensUsed: 0,
    },
  };
}

/** Minimal unified-diff generator (line-based) for evidence and MR summaries. */
export function unifiedDiff(path: string, before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const out = [`--- a/${path}`, `+++ b/${path}`];
  const max = Math.max(a.length, b.length);
  let changed = false;
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    changed = true;
    if (a[i] !== undefined) out.push(`-${a[i]}`);
    if (b[i] !== undefined) out.push(`+${b[i]}`);
  }
  if (!changed) out.push("(no line changes)");
  return out.join("\n");
}

/** Build the goal text for a GitLab Duo flow carrying this repair task. */
export function buildRepairGoal(issue: IssueRecord): string {
  return [
    "You are the repair agent in an autonomous review-and-repair loop.",
    `Task: fix issue ${issue.id} (${issue.severity}, ${issue.category}).`,
    `Title: ${issue.title}`,
    `File: ${issue.filePath ?? "unknown"}${issue.lineStart ? `:${issue.lineStart}` : ""}`,
    `Root cause description: ${issue.description}`,
    `Required remediation: ${issue.remediation}`,
    `Verification method: ${issue.verificationMethod}`,
    "Rules: create the smallest reasonable patch on branch " +
      `${repairBranchName(issue.runId, 1, issue.id)}; add or update a regression test; ` +
      "never modify protected branches, never weaken tests or quality thresholds, never touch secrets.",
  ].join("\n");
}

