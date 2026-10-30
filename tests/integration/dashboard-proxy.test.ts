import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, it } from "vitest";

it("serves JSON API responses through the dashboard and forwards authorization", async () => {
  const requests: Array<{ url?: string; authorization?: string }> = [];
  const backend = createHttpServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok" }));
  });
  let dashboard: ChildProcess | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      backend.once("error", reject);
      backend.listen(0, "127.0.0.1", resolve);
    });
    const address = backend.address();
    if (!address || typeof address === "string") throw new Error("Missing backend address");
    const root = path.resolve(__dirname, "../../apps/dashboard");
    const requireDashboard = createRequire(path.join(root, "package.json"));
    const viteCli = path.join(path.dirname(requireDashboard.resolve("vite/package.json")), "bin/vite.js");
    // Launch the same Vite version/configuration used by npm run dev:dashboard.
    dashboard = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", "0"], {
      cwd: root,
      env: { ...process.env, CONTROL_API_BASE_URL: `http://127.0.0.1:${address.port}`, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const child = dashboard;
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Dashboard startup timed out")), 10_000);
      let output = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child.once("error", (err) => { clearTimeout(timer); reject(err); });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Dashboard exited during startup (${code})`)); });
    });
    const res = await fetch(`${origin}/api/v1/health`, {
      headers: { Authorization: "Bearer fixture-dashboard-key" },
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ status: "ok" });
    expect(requests).toEqual([{ url: "/api/v1/health", authorization: "Bearer fixture-dashboard-key" }]);

    // Existing generated .js files must not shadow changes to the API client.
    const module = await fetch(`${origin}/src/pages/Settings.tsx`, { signal: AbortSignal.timeout(5000) });
    expect(module.status).toBe(200);
    expect(await module.text()).toContain("/src/api.ts");
  } finally {
    if (dashboard && dashboard.exitCode === null && dashboard.signalCode === null) {
      const child = dashboard;
      await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    }
    backend.closeAllConnections();
    await new Promise<void>((resolve, reject) => backend.close((err) => err ? reject(err) : resolve()));
  }
});
