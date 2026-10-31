// Read resolved Compose JSON from stdin; never print its secret-bearing contents.
let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  const config = JSON.parse(input);
  for (const [service, target, published] of [
    ["control-api", 4000, process.env.CONTROL_API_HOST_PORT],
    ["dashboard", 80, process.env.DASHBOARD_HOST_PORT],
  ]) {
    const ports = config.services?.[service]?.ports;
    if (!published || !Array.isArray(ports) || ports.length !== 1 ||
        ports[0].host_ip !== "127.0.0.1" || Number(ports[0].target) !== target ||
        String(ports[0].published) !== published || ports[0].protocol !== "tcp") {
      throw new Error(`${service} must publish only 127.0.0.1:${published}:${target}/tcp. Update the production overlay and run with CONTROL_API_HOST_PORT=14000 DASHBOARD_HOST_PORT=18080.`);
    }
  }
  for (const service of ["postgres", "redis"]) {
    if ((config.services?.[service]?.ports?.length ?? 0) !== 0) {
      throw new Error(`${service} must not publish host ports in production.`);
    }
  }
} catch (error) {
  console.error(`[vps-deploy] Compose preflight failed: ${error instanceof SyntaxError ? "Invalid Compose JSON" : error.message}`);
  process.exitCode = 1;
}
