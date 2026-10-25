import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { ErrorBox, Loading } from "../components/Status";

/** Policy + environment-rules editor (quality gates, approval requirements, promotion chain). */
export function Policies() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["policies"], queryFn: () => api.policies() });
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: () => api.updatePolicies(JSON.parse(text) as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["policies"] }),
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox message={(q.error as Error).message} onRetry={() => q.refetch()} />;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>Policies</h2>
      <div className="card">
        <h3>Current policy (read-only view)</h3>
        <pre className="logs">{JSON.stringify(q.data, null, 2)}</pre>
      </div>
      <div className="card">
        <h3>Update policy (admin)</h3>
        <p className="muted">Paste a JSON object like {"{ \"requiredSuites\": [\"server:unit\"], \"forbidCritical\": true }"}. Security findings are never auto-suppressed; critical/high follow these gates.</p>
        <textarea aria-label="Policy JSON" rows={6} style={{ width: "100%" }} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"requiredSuites": ["server:unit"]}' />
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" disabled={!text.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save policy"}
          </button>
        </div>
        {save.isError && <p role="alert">{(save.error as Error).message}</p>}
        {save.isSuccess && <p className="muted">Policy updated and audited.</p>}
      </div>
    </div>
  );
}
