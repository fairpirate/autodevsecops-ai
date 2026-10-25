import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading, Pill } from "../components/Status";

export function Issues() {
  const tick = useUi((s) => s.refreshToken);
  const runs = useQuery({ queryKey: ["runs-all", tick], queryFn: () => api.runs("?perPage=50") });
  const [runId, setRunId] = useState("");
  const issues = useQuery({ queryKey: ["issues", runId], queryFn: () => api.runIssues(runId), enabled: Boolean(runId) });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>Issues</h2>
      <div className="card">
        <label>Review run <select aria-label="Review run" value={runId} onChange={(e) => setRunId(e.target.value)}>
          <option value="">select a run…</option>
          {(runs.data?.items ?? []).map((r) => <option key={r.id} value={r.id}>{r.ref}@{r.commitSha.slice(0, 8)} — {r.state}</option>)}
        </select></label>
      </div>
      <div className="card">
        {!runId ? <Empty message="Select a review run to list its issue ledger." /> :
          issues.isPending ? <Loading /> : issues.isError ? <ErrorBox message={(issues.error as Error).message} onRetry={() => issues.refetch()} /> :
          issues.data.items.length === 0 ? <Empty message="No issues for this run." /> : (
            <table><thead><tr><th>Issue</th><th>Category</th><th>Severity</th><th>State</th><th>File</th></tr></thead>
            <tbody>{issues.data.items.map((i) => (
              <tr key={i.id}><td><Link to={`/issues/${i.id}`}>{i.title}</Link></td><td>{i.category}</td><td><Pill value={i.severity} /></td><td><Pill value={i.state} /></td><td>{i.filePath ?? "—"}</td></tr>
            ))}</tbody></table>
          )}
      </div>
    </div>
  );
}
