import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
const port = (target: number, published: string, host_ip = "127.0.0.1") => ({ target, published, host_ip, protocol: "tcp" });
function check(api = [port(4000, "14000")], dashboard = [port(80, "18080")], database: ReturnType<typeof port>[] = []) {
  return spawnSync(process.execPath, ["scripts/vps-check-compose.mjs"], {
    input: JSON.stringify({ services: { "control-api": { ports: api }, dashboard: { ports: dashboard }, postgres: { ports: database }, redis: {} } }),
    env: { ...process.env, CONTROL_API_HOST_PORT: "14000", DASHBOARD_HOST_PORT: "18080" }, encoding: "utf8",
  });
}
describe("production Compose preflight", () => {
  it("accepts dedicated loopback ports", () => { expect(check().status).toBe(0); });
  it("rejects the old port 4000 before starting the stack", () => {
    const result = check([port(4000, "4000")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("control-api must publish only 127.0.0.1:14000:4000/tcp");
  });
  it("rejects merged extra ports and public bindings", () => {
    expect(check([port(4000, "14000"), port(4000, "4000")]).status).toBe(1);
    expect(check(undefined, [port(80, "18080", "0.0.0.0")]).status).toBe(1);
  });
  it("rejects published database ports", () => { expect(check(undefined, undefined, [port(5432, "5432")]).status).toBe(1); });
});
