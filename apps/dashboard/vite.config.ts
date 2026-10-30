import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, ["CONTROL_API_BASE_URL", "CONTROL_API_PORT"]);
  const proxy = {
    "/api": {
      target: env.CONTROL_API_BASE_URL || `http://localhost:${env.CONTROL_API_PORT || "4000"}`,
      changeOrigin: true,
    },
  };

  return {
    plugins: [react()],
    // Share the root .env; Vite exposes only VITE_* variables to the browser.
    envDir: workspaceRoot,
    // Prefer source over the legacy generated JavaScript beside the TS files.
    resolve: { extensions: [".tsx", ".ts", ".mjs", ".js", ".jsx", ".json"] },
    server: { port: 5173, proxy },
    preview: { port: 5173, proxy },
  };
});
