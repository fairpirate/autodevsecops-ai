import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ads-nginx-"));
  dirs.push(root);
  for (const path of ["scripts", "bin", "etc/nginx/sites-available", "etc/nginx/sites-enabled", "infrastructure/nginx"]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  cpSync(resolve("infrastructure/nginx"), join(root, "infrastructure/nginx"), { recursive: true });
  // Redirect privileged paths into an isolated fake host; no host services run.
  const script = readFileSync(resolve("scripts/vps-configure-nginx.sh"), "utf8")
    .replaceAll("/etc/", `${root}/etc/`).replaceAll("/var/www/", `${root}/var/www/`);
  writeFileSync(join(root, "scripts/setup.sh"), script);
  const mock = (name: string, body: string) => writeFileSync(join(root, "bin", name), `#!/bin/bash\nset -e\n${body}\n`, { mode: 0o755 });
  mock("sudo", 'exec "$@"');
  mock("nginx", `if [[ "$1" == "-T" ]]; then echo '# configuration file ${root}/etc/nginx/sites-enabled/ai-media:'; echo 'server_name socialmedia.spiritedrobot.in;'; if [[ \"\$CONFLICT\" == 1 ]]; then echo 'server_name autodevsecops.spiritedrobot.in;'; fi; fi
if [[ "$1" == "-t" && "\$FAIL_HTTPS" == 1 ]] && grep -q 'proxy_pass' '${root}/etc/nginx/sites-available/autodevsecops' 2>/dev/null; then exit 1; fi`);
  mock("certbot", `echo certbot >> '${root}/calls'; mkdir -p '${root}/etc/letsencrypt/live/autodevsecops.spiritedrobot.in'; touch '${root}/etc/letsencrypt/live/autodevsecops.spiritedrobot.in/fullchain.pem'`);
  mock("openssl", "exit 0");
  mock("systemctl", `echo "systemctl $*" >> '${root}/calls'`);
  mock("curl", `echo "curl $*" >> '${root}/calls'`);
  const run = (fail = false, conflict = false) => spawnSync("bash", [join(root, "scripts/setup.sh"), "autodevsecops.spiritedrobot.in", "127.0.0.1:14000", "127.0.0.1:18080"], {
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, FAIL_HTTPS: fail ? "1" : "0", CONFLICT: conflict ? "1" : "0" }, encoding: "utf8",
  });
  return { root, run, site: join(root, "etc/nginx/sites-available/autodevsecops") };
}
describe("VPS Nginx lifecycle", () => {
  it("bootstraps TLS, uses isolated app ports, and reuses the certificate on rerun", () => {
    const f = fixture();
    const first = f.run();
    expect(first.status, first.stderr).toBe(0);
    const config = readFileSync(f.site, "utf8");
    expect(config).toContain("server_name autodevsecops.spiritedrobot.in;");
    expect(config).toContain("proxy_pass http://127.0.0.1:14000;");
    expect(config).toContain("proxy_pass http://127.0.0.1:18080;");
    expect(config).toContain("proxy_buffering off;");
    expect(config).toContain("listen 443 ssl;");
    expect(config).toContain("ssl_certificate ");
    expect(config).toContain("root /var/www/letsencrypt;");
    expect(config).toContain("return 301 https://autodevsecops.spiritedrobot.in$request_uri;");
    const second = f.run();
    expect(second.status, second.stderr).toBe(0);
    const calls = readFileSync(join(f.root, "calls"), "utf8");
    expect(calls.match(/^certbot$/gm)).toHaveLength(1);
    expect(calls).toContain("/api/v1/health");
    expect(calls).toContain("enable --now certbot.timer");
  });
  it("refuses a duplicate domain in another site before making changes", () => {
    const f = fixture();
    const result = f.run(false, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Domain already configured");
    expect(() => readFileSync(f.site)).toThrow();
    expect(() => readFileSync(join(f.root, "calls"))).toThrow();
  });
  it("restores an existing site when HTTPS validation fails inside the installer", () => {
    const f = fixture();
    writeFileSync(f.site, "# previous config\n");
    const result = f.run(true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("restoring the previous");
    expect(readFileSync(f.site, "utf8")).toBe("# previous config\n");
  });
  it("removes a new site after failed HTTPS validation", () => {
    const f = fixture();
    const result = f.run(true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("restoring the previous");
    expect(() => readFileSync(f.site)).toThrow();
  });
});
