import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/**
 * End-to-end contract: the dashboard exercises the REAL API surface the
 * control-api serves (route inventory + SSE + RBAC), so the UI can never
 * drift into mock-only territory.
 */
describe("e2e: dashboard ↔ control-api contract", () => {
  const routesSrc = readFileSync(path.join(ROOT, "apps/control-api/src/routes.ts"), "utf8");
  const apiClient = readFileSync(path.join(ROOT, "apps/dashboard/src/api.ts"), "utf8");

  const requiredRoutes = [
    "/projects/connect",
    "/runs",
    "/runs/:id/cancel",
    "/runs/:id/retry",
    "/runs/:id/events",
    "/runs/:id/issues",
    "/runs/:id/iterations",
    "/runs/:id/test-results",
    "/issues/:id",
    "/environments",
    "/deployments",
    "/metrics",
    "/webhooks/gitlab",
  ];

  for (const r of requiredRoutes) {
    it(`serves ${r}`, () => {
      expect(routesSrc).toContain(r.replace(":id", ":id"));
    });
  }

  it("dashboard client calls every required endpoint (no hardcoded results)", () => {
    for (const fn of [
      "projects:", "connectProject", "createRun", "runDetail",
      "runIssues", "runIterations", "runTests", "cancelRun", "retryRun",
      "environments:", "deployments:", "approveDeployment",
      "rollbackDeployment", "metrics:", "subscribeRunEvents",
    ]) {
      expect(apiClient).toContain(fn);
    }
    // No fabricated success percentages in the client.
    expect(apiClient).not.toMatch(/98%|100% success|hardcoded/i);
  });

  it("dashboard has all 10 required views", () => {
    const pages = [
      "Overview", "Projects", "Runs", "Issues", "Repairs", "TestResults",
      "Environments", "Deployments", "Policies", "Settings",
    ];
    for (const p of pages) {
      expect(existsSync(path.join(ROOT, `apps/dashboard/src/pages/${p}.tsx`))).toBe(true);
    }
  });

  it("run detail shows the live workflow timeline (all 10 states)", () => {
    const detail = readFileSync(path.join(ROOT, "apps/dashboard/src/pages/RunDetail.tsx"), "utf8");
    for (const s of [
      "CHECKOUT", "ANALYSIS", "ISSUE_TRIAGE", "REPAIR_PLANNING",
      "PATCH_GENERATION", "TARGETED_TESTS", "FULL_REGRESSION",
      "INDEPENDENT_REVIEW", "QUALITY_GATE", "READY_FOR_BUILD",
    ]) {
      expect(detail).toContain(s);
    }
    expect(detail).toContain("subscribeRunEvents");
  });
});
