import type { IssueRecord, RepairResult, TestResult, VerificationDecision } from "@ads/shared-types";
import { ruleStillMatches } from "./analyzers";
import type { FileMap } from "./ports";

export interface VerificationInputs {
  issue: IssueRecord;
  repair: RepairResult;
  /** Post-patch file contents (authoritative, from the isolated workspace). */
  filesAfter: FileMap;
  targetedTests: TestResult[];
  regressionTests: TestResult[];
  securityScanPassed?: boolean;
}

function ruleIdOf(issue: IssueRecord): string | undefined {
  return issue.evidence.find((e) => e.reference)?.reference?.split(" @")[0] ?? issue.title.split(":")[0];
}

/**
 * Agent D — Independent Verification.
 *
 * Does NOT trust the repair agent's self-assessment. It:
 *  1. confirms the original issue is addressed by re-running the deterministic
 *     check against the actual post-patch file content,
 *  2. inspects the actual diff (non-empty, touches the reported file, within
 *     patch size budget),
 *  3. treats EXECUTED test and scanner output as authoritative
 *     (AI opinions alone never establish that tests passed),
 *  4. rejects incomplete or unjustified fixes with evidence.
 */
export function verifyRepair(inputs: VerificationInputs): VerificationDecision {
  const { issue, repair, filesAfter, targetedTests, regressionTests, securityScanPassed } = inputs;
  const evidence: VerificationDecision["evidence"] = [];
  const regressions: string[] = [];
  const at = new Date().toISOString();

  // 1. Original issue addressed? (re-scan actual content)
  const ruleId = ruleIdOf(issue);
  const content = issue.filePath ? filesAfter[issue.filePath] : undefined;
  let originalAddressed = false;
  let originalCheckAvailable = false;
  if (content === undefined) {
    evidence.push({
      kind: "test_failure",
      description: `File ${issue.filePath ?? "?"} missing after repair — cannot confirm fix`,
    });
  } else if (ruleId) {
    const stillMatches = ruleStillMatches(ruleId, issue.filePath!, content);
    originalCheckAvailable = stillMatches !== undefined;
    originalAddressed = stillMatches === false;
    evidence.push({
      kind: "analyzer_rule",
      description: stillMatches === undefined
        ? `No deterministic check exists for rule ${ruleId}; human review required`
        : stillMatches
        ? `Rule ${ruleId} STILL matches ${issue.filePath} after repair`
        : `Rule ${ruleId} no longer matches ${issue.filePath} after repair`,
      reference: ruleId,
    });
  } else {
    originalAddressed = false;
    evidence.push({
      kind: "ai_finding",
      description: "No deterministic rule mapping for issue; requires AI flow verification",
    });
  }

  // 2. Inspect the actual diff.
  const diffOk =
    repair.diff.trim().length > 0 &&
    !repair.diff.includes("(no line changes)") &&
    repair.filesChanged.includes(issue.filePath ?? "\u0000");
  evidence.push({
    kind: "human",
    description: diffOk
      ? `Diff reviewed: ${repair.filesChanged.join(", ")} (${repair.patchSizeLines} lines)`
      : "Diff missing, empty, or does not touch the reported file",
    reference: repair.branch,
    snippet: repair.diff.slice(0, 500),
  });

  // 3. Tests/scanner output are authoritative.
  const targetedOk = targetedTests.length > 0 && targetedTests.every((t) => t.passed);
  const regressionOk = regressionTests.length > 0 && regressionTests.every((t) => t.passed);
  evidence.push({
    kind: "test_failure",
    description: `Executed targeted tests: ${targetedTests.filter((t) => t.passed).length}/${targetedTests.length} suites passed`,
  });
  evidence.push({
    kind: "test_failure",
    description: `Executed regression tests: ${regressionTests.filter((t) => t.passed).length}/${regressionTests.length} suites passed`,
  });
  for (const t of [...targetedTests, ...regressionTests]) {
    if (!t.passed) regressions.push(`${t.suite}: ${t.failureSummary ?? "failed"}`);
  }
  if (securityScanPassed === false) {
    regressions.push("security scan failed after repair");
    evidence.push({ kind: "scanner", description: "Security scan FAILED on repaired tree" });
  } else if (securityScanPassed === true) {
    evidence.push({ kind: "scanner", description: "Security scan passed on repaired tree" });
  }

  // 4. Reject unjustified fixes.
  const justifed = repair.explanation.trim().length >= 20 && repair.rootCause.trim().length >= 10;
  const testsOk = targetedOk && regressionOk;
  const verdict: VerificationDecision["verdict"] =
    originalAddressed && diffOk && testsOk && justifed && securityScanPassed === true && regressions.length === 0
      ? "verified_fixed"
      : originalAddressed && regressions.length > 0
        ? "rejected"
        : !originalAddressed && originalCheckAvailable
          ? "rejected"
          : "inconclusive";

  const confidence =
    verdict === "verified_fixed"
      ? Math.min(0.99, 0.5 + (originalAddressed ? 0.2 : 0) + (diffOk ? 0.15 : 0) + (testsOk ? 0.14 : 0))
      : verdict === "rejected"
        ? 0.9
        : 0.5;

  return {
    issueId: issue.id,
    verdict,
    confidence,
    diffReviewed: diffOk,
    testsReviewed: true,
    scannerOutputReviewed: securityScanPassed !== undefined,
    originalIssueAddressed: originalAddressed,
    regressionsIntroduced: regressions,
    evidence,
    rationale:
      verdict === "verified_fixed"
        ? `Independent re-check confirms rule cleared, diff touches target file, and ${targetedTests.length + regressionTests.length} executed suites passed.`
        : verdict === "rejected"
          ? `Fix rejected: ${!originalAddressed ? "original issue still present" : "regressions detected"} — ${regressions.join("; ") || "see evidence"}`
          : "Inconclusive: evidence insufficient to confirm fix",
    reviewer: "independent-verification-agent",
    at,
  };
}
