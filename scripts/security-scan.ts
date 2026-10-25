/**
 * Deterministic secret-leak scanner for CI (`secret-detection` job).
 * Fails the pipeline when probable secrets are committed to the repo.
 * Scans tracked text files only; never prints secret VALUES (only file:line).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "gitlab-pat", re: /glpat-[A-Za-z0-9_\-]{10,}/ },
  { name: "aws-key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "bearer-token", re: /Bearer\s+[A-Za-z0-9_\-\.]{20,}/i },
  { name: "password-assign", re: /(password|passwd|pwd)\s*=\s*['"][^'"]{4,}['"]/i },
];

const ALLOW = /(^|\/)(README|\.env\.example|.*\.test\.ts|.*\.md)$|\.gitlab-ci\.yml$/;

function trackedFiles(): string[] {
  try {
    return execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

let violations = 0;
for (const f of trackedFiles()) {
  if (ALLOW.test(f)) continue;
  if (/\.(png|jpg|jpeg|gif|lock|map)$/.test(f)) continue;
  let content: string;
  try {
    content = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  content.split("\n").forEach((line, i) => {
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        console.error(`[secret-scan] ${p.name} suspected at ${f}:${i + 1}`);
        violations++;
        break;
      }
    }
  });
}

if (violations > 0) {
  console.error(`[secret-scan] FAILED: ${violations} suspected secret(s) committed.`);
  process.exit(1);
}
console.log("[secret-scan] passed: no committed secrets detected.");
