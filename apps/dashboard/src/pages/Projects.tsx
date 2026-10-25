import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Empty, ErrorBox, Loading } from "../components/Status";

export function Projects() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["projects"], queryFn: () => api.projects() });
  const [form, setForm] = useState({ gitlabBaseUrl: "https://gitlab.com", gitlabProjectId: "", token: "" });
  const connect = useMutation({
    mutationFn: () =>
      api.connectProject({
        gitlabBaseUrl: form.gitlabBaseUrl,
        gitlabProjectId: form.gitlabProjectId ? Number(form.gitlabProjectId) : undefined,
        token: form.token,
      }),
    onSuccess: () => {
      setForm((f) => ({ ...f, token: "" }));
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>Projects</h2>
      <div className="card">
        <h3>Connect a GitLab project</h3>
        <div className="row">
          <input aria-label="GitLab base URL" value={form.gitlabBaseUrl} onChange={(e) => setForm({ ...form, gitlabBaseUrl: e.target.value })} style={{ minWidth: 220 }} />
          <input aria-label="GitLab project ID" value={form.gitlabProjectId} onChange={(e) => setForm({ ...form, gitlabProjectId: e.target.value })} placeholder="Project ID (e.g. 123)" />
          <input aria-label="Access token" type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="glpat-…" style={{ minWidth: 220 }} />
          <button type="button" disabled={!form.token || connect.isPending} onClick={() => connect.mutate()}>
            {connect.isPending ? "Connecting…" : "Connect"}
          </button>
        </div>
        {connect.isError && <p role="alert">{(connect.error as Error).message}</p>}
        {connect.isSuccess && <p className="muted">Connected — token stored encrypted, never logged.</p>}
      </div>
      <div className="card">
        <h3>Connected projects</h3>
        {list.isPending ? <Loading /> : list.isError ? <ErrorBox message={(list.error as Error).message} onRetry={() => list.refetch()} /> : (list.data.items as unknown[]).length === 0 ? <Empty message="No projects connected yet." /> : (
          <table>
            <thead><tr><th>Name</th><th>Path</th><th>Default branch</th><th>URL</th></tr></thead>
            <tbody>
              {(list.data.items as Array<{ id: string; name: string; pathWithNamespace: string; defaultBranch: string; webUrl: string }>).map((p) => (
                <tr key={p.id}><td>{p.name}</td><td>{p.pathWithNamespace}</td><td>{p.defaultBranch}</td><td><a href={p.webUrl} target="_blank" rel="noreferrer">open</a></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
