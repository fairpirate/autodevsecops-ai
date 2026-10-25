import type { NewIssueInput } from "@ads/issue-ledger";
import type { FileMap } from "./ports";

const JS_EXT = /\.(m?jsx?|ts|tsx)$/;

interface Rule {
  id: string;
  pattern: RegExp;
  title: string;
  category: NewIssueInput["category"];
  severity: NewIssueInput["severity"];
  confidence: number;
  impact: string;
  remediation: string;
  verificationMethod: string;
  /** Advisory rules never block release on their own. */
  advisory?: boolean;
  /** Restrict rule to files matching this extension regex. */
  ext?: RegExp;
}

/** Deterministic code-review rules (supplemented by AI reasoning when enabled). */
const CODE_RULES: Rule[] = [
  {
    id: "AVS101",
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    title: "Empty catch block swallows errors",
    category: "error_handling",
    severity: "high",
    confidence: 0.95,
    impact: "Failures are silently ignored, making incidents undiagnosable.",
    remediation: "Handle the error (log with context or rethrow) instead of ignoring it.",
    verificationMethod: "Re-scan: no empty catch blocks; add a test covering the failure path.",
  },
  {
    id: "AVS102",
    pattern: /\bdebugger\b/g,
    title: "Debugger statement left in code",
    category: "code_quality",
    severity: "medium",
    confidence: 0.99,
    impact: "Pauses execution for anyone debugging; leftover dev code.",
    remediation: "Remove the debugger statement before merging.",
    verificationMethod: "Re-scan: no 'debugger' tokens in changed files.",
  },
  {
    id: "AVS103",
    pattern: /console\.log\s*\(/g,
    title: "Leftover console.log in source",
    category: "code_quality",
    severity: "low",
    confidence: 0.7,
    impact: "Noisy output in production; may leak internal state.",
    remediation: "Remove or replace with the project's structured logger.",
    verificationMethod: "Re-scan: no console.log in production source paths.",
    advisory: true,
    ext: JS_EXT,
  },
];

/** Deterministic security rules — policy severities are never auto-suppressed. */
const SECURITY_RULES: Rule[] = [
  {
    id: "AVSS01",
    pattern: /\beval\s*\(/g,
    title: "Use of eval() enables code injection",
    category: "security",
    severity: "critical",
    confidence: 0.98,
    impact: "Attacker-controlled input can execute arbitrary code.",
    remediation: "Replace eval with explicit parsing or safe dispatch logic.",
    verificationMethod: "Re-scan: no eval( in source; add injection regression test.",
  },
  {
    id: "AVSS02",
    pattern: /["'`](?:SELECT|INSERT|UPDATE|DELETE)[^"'`]*["'`]\s*\+/gi,
    title: "SQL built by string concatenation (injection risk)",
    category: "security",
    severity: "critical",
    confidence: 0.9,
    impact: "Untrusted data concatenated into SQL enables SQL injection.",
    remediation: "Use parameterized queries / prepared statements.",
    verificationMethod: "Re-scan: no concatenated SQL; add parameterized-query test.",
  },
  {
    id: "AVSS03",
    pattern: /\.(?:innerHTML|outerHTML)\s*=\s*[A-Za-z_$]/g,
    title: "Dynamic HTML assignment may enable XSS",
    category: "security",
    severity: "high",
    confidence: 0.75,
    impact: "Assigning untrusted values to innerHTML can execute scripts in the page.",
    remediation: "Use textContent or sanitize with an allow-list sanitizer.",
    verificationMethod: "Re-scan: no dynamic innerHTML assignment; add XSS regression test.",
  },
  {
    id: "AVSS04",
    pattern: /(?:password|passwd|secret|api_?key|access_?token)\s*[:=]\s*["'][^"']{6,}["']/gi,
    title: "Possible hardcoded credential",
    category: "security",
    severity: "critical",
    confidence: 0.85,
    impact: "Secrets in source leak via history and distributions.",
    remediation: "Move the value to environment/secret manager and rotate it.",
    verificationMethod: "Secret scan passes; credential loaded from environment in test.",
  },
  {
    id: "AVSS05",
    pattern: /createHash\s*\(\s*["'](?:md5|sha1)["']\s*\)/g,
    title: "Weak hash algorithm (md5/sha1)",
    category: "security",
    severity: "high",
    confidence: 0.95,
    impact: "Weak digests are collision-prone and unsafe for security controls.",
    remediation: "Use SHA-256 or stronger, or a password KDF (bcrypt/scrypt/argon2).",
    verificationMethod: "Re-scan: no md5/sha1 createHash; verification test uses strong hash.",
  },
];
export interface ScanFinding {
  ruleId: string;
  filePath: string;
  line: number;
  snippet: string;
  input: NewIssueInput;
}

const IGNORE = /(^|\/)(node_modules|dist|build|coverage|vendor)\//;

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function applyRule(rule: Rule, runId: string, sha: string, filePath: string, content: string): ScanFinding | null {
  if (rule.ext && !rule.ext.test(filePath)) return null;
  rule.pattern.lastIndex = 0;
  const m = rule.pattern.exec(content);
  if (!m) return null;
  const line = lineOf(content, m.index);
  const snippet = content.split("\n")[line - 1]?.trim().slice(0, 200) ?? "";
  const blocksRelease = !rule.advisory && (rule.severity === "critical" || rule.severity === "high");
  return {
    ruleId: rule.id,
    filePath,
    line,
    snippet,
    input: {
      runId,
      title: `${rule.id}: ${rule.title}`,
      description: `${rule.title} in ${filePath}:${line}. Rule ${rule.id} matched reproducibly.`,
      category: rule.category,
      severity: rule.severity,
      confidence: rule.confidence,
      filePath,
      lineStart: line,
      lineEnd: line,
      evidence: [
        {
          kind: "analyzer_rule",
          description: `${rule.id} matched at ${filePath}:${line}`,
          reference: `${rule.id} @ ${filePath}:${line}`,
          snippet,
        },
      ],
      impact: rule.impact,
      remediation: rule.remediation,
      verificationMethod: rule.verificationMethod,
      blocksRelease,
      discoverySource: `deterministic:${rule.category === "security" ? "security-review" : "code-review"}`,
      affectedRevision: sha,
    },
  };
}

/** Deterministic code review across the checked-out files. */
export function runCodeReview(runId: string, sha: string, files: FileMap): ScanFinding[] {
  const out: ScanFinding[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (IGNORE.test(path)) continue;
    for (const rule of CODE_RULES) {
      const f = applyRule(rule, runId, sha, path, content);
      if (f) out.push(f);
    }
  }
  return out;
}

/** Deterministic security review across the checked-out files. */
export function runSecurityReview(runId: string, sha: string, files: FileMap): ScanFinding[] {
  const out: ScanFinding[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (IGNORE.test(path)) continue;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) continue;
    for (const rule of SECURITY_RULES) {
      const f = applyRule(rule, runId, sha, path, content);
      if (f) out.push(f);
    }
  }
  return out;
}

/** Whether a specific rule still matches file content (used by verification). */
export function ruleStillMatches(ruleId: string, filePath: string, content: string): boolean {
  const rule = [...CODE_RULES, ...SECURITY_RULES].find((r) => r.id === ruleId);
  if (!rule) return false;
  rule.pattern.lastIndex = 0;
  return rule.pattern.test(content);
}

/**
 * Changed source files without an adjacent/related test change are reported
 * as a missing-test finding (advisory, non-blocking).
 */
export function analyzeMissingTests(
  runId: string,
  sha: string,
  files: FileMap,
  changedPaths: string[],
): ScanFinding[] {
  const out: ScanFinding[] = [];
  const allPaths = Object.keys(files);
  for (const p of changedPaths) {
    if (!/\.(m?jsx?|ts|tsx)$/.test(p)) continue;
    if (/\.(test|spec)\./.test(p)) continue;
    if (IGNORE.test(p)) continue;
    const base = p.replace(/\.[^.]+$/, "");
    const hasRelatedTest = allPaths.some(
      (t) => t.includes(base) && /\.(test|spec)\./.test(t),
    );
    if (!hasRelatedTest) {
      out.push({
        ruleId: "AVS201",
        filePath: p,
        line: 1,
        snippet: "",
        input: {
          runId,
          title: `AVS201: No test coverage for changed file ${p}`,
          description: `Source file ${p} changed without a corresponding test file.`,
          category: "missing_test",
          severity: "medium",
          confidence: 0.7,
          filePath: p,
          lineStart: 1,
          evidence: [
            {
              kind: "analyzer_rule",
              description: `No test file found for ${p}`,
              reference: "AVS201",
            },
          ],
          impact: "Regressions in this file may ship undetected.",
          remediation: "Add unit/component tests covering the changed behavior.",
          verificationMethod: "A test file covering the path exists and passes.",
          blocksRelease: false,
          discoverySource: "deterministic:code-review",
          affectedRevision: sha,
        },
      });
    }
  }
  return out;
}

