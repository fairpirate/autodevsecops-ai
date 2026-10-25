import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading, Pill } from "../components/Status";

export function Runs() {
  const qc = useQueryClient();
  const tick = useUi((s) => s.refreshToken);
  const [filter, setFilter] = useState("");
  const list = useQuery({ queryKey: ["runs", filter, tick], queryFn: () => api.runs(filter ? `?state=${filter}` : "") });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.createRun(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runs"] }),
  });
  const [form, setForm] = useState({ projectId: "", ref: "main", commitSha: "" });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>Review Runs</h2>
      <div className="card">
        <h3>Start a review run</h3>
        <div className="row">
          <input aria-label="Project ID" placeholder="project id" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} />
          <input aria-label="Ref" placeholder="ref" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} />
          <input aria-label="Commit SHA" placeholder="commit sha" value={form.commitSha} onChange={(e) => setForm({ ...form, commitSha: e.target.value })} style={{ minWidth: 260 }} />
          <button type="button" disabled={!form.projectId || !form.commitSha || create.isPending} onClick={() => create.mutate(form)}>
            {create.isPending ? "Starting…" : "Start run"}
          </button>
        </div>
        {create.isError && <p role="alert">{(create.error as Error).message}</p>}
      </div>
      <div className="card">
        <div className="row">
          <label>Filter by state <select aria-label="State filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">all</option>
            {["INITIALIZED","CHECKOUT","ANALYSIS","ISSUE_TRIAGE","REPAIR_PLANNING","PATCH_GENERATION","TARGETED_TESTS","FULL_REGRESSION","INDEPENDENT_REVIEW","QUALITY_GATE","NEXT_ITERATION","READY_FOR_BUILD","BLOCKED","FAILED","CANCELLED","NEEDS_HUMAN_REVIEW"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
        </div>
        {list.isPending ? <Loading /> : list.isError ? <ErrorBox message={(list.error as Error).message} onRetry={() => list.refetch()} /> : list.data.items.length === 0 ? <Empty message="No runs yet." /> : (
          <table><thead><tr><th>Run</th><th>State</th><th>Iter</th><th>Stop reason</th><th>Updated</th></tr></thead>
          <tbody>{list.data.items.map((r) => (
            <tr key={r.id}><td><Link to={`/runs/${r.id}`}>{r.ref}@{r.commitSha.slice(0, 8)}</Link></td><td><Pill value={r.state} /></td><td>{r.iteration}</td><td>{r.stopReason ?? "—"}</td><td>{new Date(r.updatedAt).toLocaleString()}</td></tr>
          ))}</tbody></table>
        )}
      </div>
    </div>
  );
}
