import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { ErrorBox, Loading } from "../components/Status";

export function Settings() {
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api.audit() });
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.health() });
  return (
    <div className="grid" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>Settings</h2>
      <div className="card">
        <h3>Control API health</h3>
        {health.isPending ? <Loading /> : health.isError ? <ErrorBox message={(health.error as Error).message} /> : (
          <pre className="logs">{JSON.stringify(health.data, null, 2)}</pre>
        )}
        <p className="muted">Tokens are encrypted at rest (AES-256-GCM), redacted in logs, and never sent to AI agents. Budget env vars: MAX_ITERATIONS, MAX_RUNTIME_MINUTES, MAX_TOKEN_BUDGET, MAX_PATCH_SIZE_LINES, MIN_VERIFICATION_CONFIDENCE.</p>
      </div>
      <div className="card">
        <h3>Audit log</h3>
        {audit.isPending ? <Loading /> : audit.isError ? <ErrorBox message={(audit.error as Error).message} /> : (
          <pre className="logs">{JSON.stringify(audit.data.items, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
