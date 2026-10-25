import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { ErrorBox, Loading, Pill } from "../components/Status";

export function IssueDetail() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["issue", id], queryFn: () => api.issue(id) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const i = q.data.issue as unknown as Record<string, unknown>;
  const evidence = (i.evidence as Array<{ kind: string; description: string }>) ?? [];
  const history = (i.history as Array<{ at: string; to: string; actor: string; reason: string }>) ?? [];
  const verification = i.verification as { reviewer?: string; verdict?: string; confidence?: number; evidence?: string[] } | undefined;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>{String(i.title)}</h2>
        <Pill value={String(i.severity)} />
        <Pill value={String(i.state)} />
      </div>
      <div className="grid cols-2">
        <div className="card">
          <h3>Location & impact</h3>
          <p>File: {(i.filePath as string) ?? "—"}{(i.lineStart as number) ? `:${i.lineStart}` : ""}</p>
          <p>Category: {String(i.category)} · Blocks release: {String(i.blocksRelease)}</p>
          <p>{String(i.description ?? "")}</p>
          <h3>Remediation</h3>
          <p>{String(i.suggestedRemediation ?? "—")}</p>
          <p className="muted">Verify via: {String(i.verificationMethod ?? "—")}</p>
        </div>
        <div className="card">
          <h3>Evidence ({evidence.length})</h3>
          <ul>{evidence.map((e, n) => <li key={n}><strong>{e.kind}:</strong> {e.description}</li>)}</ul>
          <h3>Independent verification</h3>
          {verification ? (
            <ul>
              <li>Reviewer: {verification.reviewer}</li>
              <li>Verdict: {verification.verdict} (confidence {verification.confidence})</li>
              {(verification.evidence ?? []).map((e, n) => <li key={n}>{e}</li>)}
            </ul>
          ) : <p className="muted">Not yet verified — test/scanner output is authoritative, never AI self-assessment.</p>}
          <h3>History</h3>
          <ul>{history.map((h, n) => <li key={n}>{new Date(h.at).toLocaleString()} → {h.to} by {h.actor}: {h.reason}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
