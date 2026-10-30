import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, subscribeRunEvents } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading, Pill } from "../components/Status";

const STEPS = ["CHECKOUT","ANALYSIS","ISSUE_TRIAGE","REPAIR_PLANNING","PATCH_GENERATION","TARGETED_TESTS","FULL_REGRESSION","INDEPENDENT_REVIEW","QUALITY_GATE","NEXT_ITERATION","READY_FOR_BUILD"] as const;

export function RunDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const tick = useUi((s) => s.refreshToken);
  const detail = useQuery({ queryKey: ["run", id, tick], queryFn: () => api.runDetail(id) });
  const iterations = useQuery({ queryKey: ["iterations", id], queryFn: () => api.runIterations(id) });
  const tests = useQuery({ queryKey: ["run-tests", id, tick], queryFn: () => api.runTests(id) });
  const [live, setLive] = useState<Array<{ type: string; payload: unknown }>>([]);

  useEffect(() => subscribeRunEvents(id, (e) => {
    setLive((l) => [...l.slice(-49), e]);
    qc.invalidateQueries({ queryKey: ["run", id] });
  }), [id, qc]);

  const cancel = useMutation({ mutationFn: () => api.cancelRun(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["run", id] }) });
  const retry = useMutation({ mutationFn: () => api.retryRun(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["runs"] }) });

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorBox message={(detail.error as Error).message} onRetry={() => detail.refetch()} />;
  const data = detail.data;
  const run = data.run;
  const issues = data.issues ?? [];
  const gates = data.gates ?? [];
  const metrics = data.metrics ?? {};
  const activeIdx = STEPS.indexOf(run.state as (typeof STEPS)[number]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>Run {run.ref}@{run.commitSha?.slice(0, 8) ?? "—"}</h2>
        <Pill value={run.state} />
        <span className="muted">iteration {run.iteration}{run.stopReason ? ` · ${run.stopReason}` : ""}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel</button>
        <button type="button" className="ghost" disabled={retry.isPending} onClick={() => retry.mutate()}>Retry as child run</button>
      </div>
      {(cancel.isError || retry.isError) && <p role="alert">{((cancel.error ?? retry.error) as Error).message}</p>}

      <div className="card">
        <h3>Workflow timeline (live)</h3>
        <div className="timeline">
          {STEPS.map((s, i) => (
            <div className="step" key={s}>
              <strong>{s}</strong> {i < activeIdx ? "— done" : i === activeIdx ? "— current" : "— pending"}
            </div>
          ))}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Findings ({issues.length})</h3>
          {issues.length === 0 ? <Empty message="No findings recorded." /> : (
            <table><thead><tr><th>Issue</th><th>Severity</th><th>State</th></tr></thead>
            <tbody>{issues.map((i) => (
              <tr key={i.id}><td><Link to={`/issues/${i.id}`}>{i.title}</Link></td><td><Pill value={i.severity} /></td><td><Pill value={i.state} /></td></tr>
            ))}</tbody></table>
          )}
          <h3>Quality gates</h3>
          <ul>{gates.map((g) => <li key={g.gate}>{g.gate}: <Pill value={g.passed ? "pass" : "failed"} /> — {g.detail}</li>)}</ul>
          <h3>Metrics</h3>
          <pre className="logs">{JSON.stringify(metrics, null, 2)}</pre>
        </div>
        <div className="card">
          <h3>Test results ({tests.data?.items.length ?? 0})</h3>
          {tests.isPending ? <Loading /> : (tests.data?.items ?? []).length === 0 ? <Empty message="No test results yet." /> : (
            <table><thead><tr><th>Suite</th><th>Platform</th><th>Result</th><th>Duration</th></tr></thead>
            <tbody>{tests.data!.items.map((t, n) => (
              <tr key={n}><td>{t.suite}</td><td>{t.platform}</td><td><Pill value={t.passed ? "pass" : "failed"} /></td><td>{t.durationMs}ms</td></tr>
            ))}</tbody></table>
          )}
          <h3>Iterations</h3>
          {iterations.isPending ? <Loading /> : (
            <ul>{(iterations.data?.items ?? []).map((it) => <li key={it.iteration}>#{it.iteration} · {it.events.length} events · {new Date(it.at).toLocaleTimeString()}</li>)}</ul>
          )}
          <h3>Live events ({live.length})</h3>
          <pre className="logs" aria-live="polite">{live.length === 0 ? "Waiting for live events…" : live.map((e, n) => `${n + 1}. ${e.type}`).join("\n")}</pre>
        </div>
      </div>
    </div>
  );
}
