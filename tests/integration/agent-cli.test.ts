import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const roles = [
  ["code-review", "review"], ["security-review", "review"], ["repair", "repair"],
  ["verification", "verification"], ["release", "release"],
] as const;

describe("executable agent entry points", () => {
  for (const [role, fixture] of roles) {
    it(`runs ${role} with JSON output and no network credentials`, () => {
      const result = spawnSync(process.execPath, ["--import", "tsx", `agents/${role}/run.ts`, "--input", `agents/examples/${fixture}.json`], {
        cwd: root, encoding: "utf8", timeout: 10000,
        env: { ...process.env, NEBIUS_API_KEY: "", GITLAB_INTEGRATION_TOKEN: "" },
      });
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.agent).toBe(role);
      if (role === "repair") expect(output.applied).toBe(false);
      if (role === "verification") expect(output.decision.verdict).toBe("inconclusive");
      if (role === "release") expect(output).toMatchObject({ eligible: false, deployed: false });
    });
  }

  it("accepts stdin JSON and returns safe structured validation errors", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "agents/code-review/run.ts"], {
      cwd: root, encoding: "utf8", timeout: 10000, input: '{"files":"bad"}',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ agent: "code-review", error: { code: "invalid_input" } });
  });
});
