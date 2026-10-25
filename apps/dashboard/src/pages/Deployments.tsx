import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading, Pill } from "../components/Status";

export function Deployments() {
  const qc = useQueryClient();
  const tick = useUi((s) => s.refreshToken);
  const list = useQuery({ queryKey: ["deployments", tick], queryFn: () => api.deployments() });
  const [form, setForm] = useState({ releaseId: "", environment: "development" });
  const approve = useMutation({ mutationFn: (id: string) => api.approveDeployment(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["deployments"] }) });
  const rollback = useMutation({ mutationFn: (id: string) => api.rollbackDeployment(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["deployments"] }) });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>Deployments</h2>
      <div className="card">
        <h3>Artifact identity & provenance</h3>
        <p className="muted">Every deployment promotes one immutable artifact (sha256 digest). Same digest moves development → staging → production; any code change requires a new validated artifact.</p>
      </div>
      <div className="card">
        {list.isPending ? <Loading /> : list.isError ? <ErrorBox message={(list.error as Error).message} onRetry={() => list.refetch()} /> : list.data.items.length === 0 ? <Empty message="No deployments yet — create a release from a READY_FOR_BUILD run first." /> : (
          <table><thead><tr><th>Environment</th><th>Status</th><th>Artifact</th><th>Approvals</th><th>Health</th><th>Actions</th></tr></thead>
          <tbody>{list.data.items.map((d) => (
            <tr key={d.id}>
              <td>{d.environment}</td>
              <td><Pill value={d.status} /></td>
              <td>{d.artifactDigest.slice(0, 16)}…</td>
              <td>{d.approvals.length}</td>
              <td>{d.healthChecks.length === 0 ? "—" : d.healthChecks.map((h) => `${h.name}:${h.ok ? "ok" : "FAIL"}`).join(", ")}</td>
              <td>
                <div className="row">
                  <button type="button" className="ghost" disabled={approve.isPending} onClick={() => approve.mutate(d.id)}>Approve</button>
                  <button type="button" className="ghost" disabled={!d.rollbackAvailable || rollback.isPending} onClick={() => rollback.mutate(d.id)}>Rollback</button>
                </div>
              </td>
            </tr>
          ))}</tbody></table>
        )}
        {(approve.isError || rollback.isError) && <p role="alert">{((approve.error ?? rollback.error) as Error).message}</p>}
      </div>
    </div>
  );
}
