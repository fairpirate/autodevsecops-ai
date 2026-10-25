import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useUi } from "../store";
import { ErrorBox, Loading, Pill } from "../components/Status";

export function Environments() {
  const tick = useUi((s) => s.refreshToken);
  const envs = useQuery({ queryKey: ["environments", tick], queryFn: () => api.environments() });
  if (envs.isPending) return <Loading />;
  if (envs.isError) return <ErrorBox message={(envs.error as Error).message} onRetry={() => envs.refetch()} />;
  return (
    <div className="grid" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>Environments</h2>
      {envs.data.items.map((e) => (
        <div className="card" key={e.environment}>
          <h3>{e.environment} — <Pill value={e.status} /></h3>
          {e.lastDeployment ? (
            <p>Last: {e.lastDeployment.status} · {e.lastDeployment.artifactDigest.slice(0, 20)}… · approvals: {e.lastDeployment.approvals.length} · rollback {e.lastDeployment.rollbackAvailable ? "available" : "unavailable"}</p>
          ) : <p className="muted">Never deployed. Local compose profiles simulate per-env behavior; real staging/production use protected GitLab environments.</p>}
        </div>
      ))}
    </div>
  );
}
