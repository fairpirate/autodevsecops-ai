import { defineConfig } from "vitest/config";
import path from "node:path";

const r = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      "@ads/shared-types": r("packages/shared-types/src/index.ts"),
      "@ads/issue-ledger": r("packages/issue-ledger/src/index.ts"),
      "@ads/policy-engine": r("packages/policy-engine/src/index.ts"),
      "@ads/workflow-engine": r("packages/workflow-engine/src/index.ts"),
      "@ads/test-adapters": r("packages/test-adapters/src/index.ts"),
      "@ads/gitlab-integration": r("services/gitlab-integration/src/index.ts"),
      "@ads/artifact-service": r("services/artifact-service/src/index.ts"),
      "@ads/orchestrator": r("services/orchestrator/src/index.ts"),
      "@ads/execution-worker": r("services/execution-worker/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts", "services/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
