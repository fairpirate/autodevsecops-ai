import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading, Pill } from "../components/Status";

export function Runs() {
  const qc = useQueryClient();
  const tick = useUi((s) => s.refreshToken);
  const [filter, setFilter] = useState("");
  const list = useQuery({ queryKey: ["runs", filter, tick], queryFn: () => api.runs(filter ? `?state=${filter}` : "") });
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.projects() });
  const projectId = params.get("projectId") ?? projects.data?.items[0]?.id ?? "";
  const project = projects.data?.items.find((p) => p.id === projectId);
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.createRun(body),
    onSuccess: ({ run }) => {
      void qc.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/runs/${run.id}`);
    },
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>Review Runs</h2>
      <div className="card">
        <h3>Start a review run</h3>
        {projects.isPending ? <Loading /> : projects.isError ? (
          <ErrorBox message={projects.error.message} onRetry={() => projects.refetch()} />
        ) : projects.data.items.length === 0 ? (
          <p><Link to="/projects">Connect a GitLab project</Link> to review its commits.</p>
        ) : <>
          <label>Connected project <select aria-label="Connected project" value={projectId} disabled={create.isPending}
            onChange={(e) => { setParams({ projectId: e.target.value }); create.reset(); }}>
            <option value="" disabled>Select a project</option>
            {projects.data.items.map((p) => <option key={p.id} value={p.id}>{p.pathWithNamespace}</option>)}
          </select></label>
          {project ? <CommitPicker key={project.id} projectId={project.id} defaultBranch={project.defaultBranch}
            pending={create.isPending} onStart={(ref, commitSha) => create.mutate({ projectId: project.id, ref, commitSha })} />
            : <Empty message="Choose a connected project to load commits." />}
        </>}
        {create.isError && <p role="alert">{create.error.message}</p>}
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

function CommitPicker({ projectId, defaultBranch, pending, onStart }: {
  projectId: string; defaultBranch: string; pending: boolean;
  onStart: (ref: string, sha: string) => void;
}) {
  const [ref, setRef] = useState(defaultBranch || "main");
  const [draftRef, setDraftRef] = useState(ref);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState("");
  const commits = useQuery({
    queryKey: ["project-commits", projectId, ref, page],
    queryFn: () => api.commits(projectId, ref, page),
  });
  const changePage = (next: number) => { setSelected(""); setPage(next); };
  const canStart = !pending && !commits.isFetching && !commits.isError
    && commits.data?.items.some((c) => c.id === selected);
  return <div className="grid" style={{ gap: 12, marginTop: 16 }}>
    <form className="row" onSubmit={(e) => {
      e.preventDefault();
      if (!draftRef.trim() || pending) return;
      setSelected(""); setPage(1); setRef(draftRef.trim());
    }}>
      <label>Branch or tag <input aria-label="Branch or tag" value={draftRef} disabled={pending}
        onChange={(e) => setDraftRef(e.target.value)} /></label>
      <button disabled={pending || !draftRef.trim()} type="submit">Load commits</button>
    </form>
    <p className="muted">Select a commit on {ref} to review that exact revision.</p>
    {commits.isPending ? <Loading /> : commits.isError ?
      <ErrorBox message={commits.error.message} onRetry={() => commits.refetch()} /> :
      commits.data.items.length === 0 ? <Empty message="No commits on this page. Try a previous page or another branch." /> :
      <div style={{ overflowX: "auto" }}><table>
        <thead><tr><th>Select</th><th>Commit</th><th>Message</th><th>Author</th><th>Date</th></tr></thead>
        <tbody>{commits.data.items.map((c) => <tr key={c.id}>
          <td><input type="radio" name="review-commit" aria-label={`Review commit ${c.short_id}: ${c.title}`}
            checked={selected === c.id} disabled={pending || commits.isFetching} onChange={() => setSelected(c.id)} /></td>
          <td><code title={c.id}>{c.short_id}</code></td><td>{c.title}</td><td>{c.author_name}</td>
          <td>{new Date(c.created_at).toLocaleString()}</td>
        </tr>)}</tbody>
      </table></div>}
    <div className="row">
      <button type="button" disabled={page === 1 || pending || commits.isFetching} onClick={() => changePage(page - 1)}>Previous</button>
      <span>Page {page}</span>
      <button type="button" disabled={!commits.data?.hasNext || commits.isError || pending || commits.isFetching} onClick={() => changePage(page + 1)}>Next</button>
      <button type="button" disabled={!canStart} onClick={() => onStart(ref, selected)}>{pending ? "Starting…" : "Run review"}</button>
    </div>
  </div>;
}
