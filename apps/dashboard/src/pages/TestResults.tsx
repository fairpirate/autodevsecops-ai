import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading, Pill } from "../components/Status";

export function TestResults() {
  const tick = useUi((s) => s.refreshToken);
  const runs = useQuery({ queryKey: ["runs-tests", tick], queryFn: () => api.runs("?perPage=20") });
  const [runId, setRunId] = useState("");
  const tests = useQuery({ queryKey: ["tests", runId], queryFn: () => api.runTests(runId), enabled: Boolean(runId) });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>Test Results</h2>
      <div className="card">
        <label>Review run <select aria-label="Review run" value={runId} onChange={(e) => setRunId(e.target.value)}>
          <option value="">select a run…</option>
          {(runs.data?.items ?? []).map((r) => <option key={r.id} value={r.id}>{r.ref}@{r.commitSha.slice(0, 8)} — {r.state}</option>)}
        </select></label>
      </div>
      <div className="card">
        {!runId ? <Empty message="Select a run to view structured test evidence (suite, platform, pass/fail, duration, logs)." /> :
          tests.isPending ? <Loading /> : tests.isError ? <ErrorBox message={(tests.error as Error).message} onRetry={() => tests.refetch()} /> :
          tests.data.items.length === 0 ? <Empty message="No test results recorded." /> : (
            <table><thead><tr><th>Suite</th><th>Platform</th><th>Result</th><th>Duration</th><th>Failure summary</th><th>Timestamp</th></tr></thead>
            <tbody>{tests.data.items.map((t, n) => (
              <tr key={n}><td>{t.suite}</td><td>{t.platform}</td><td><Pill value={t.passed ? "pass" : "failed"} /></td><td>{t.durationMs}ms</td><td>{t.failureSummary ?? "—"}</td><td>{new Date(t.timestamp).toLocaleString()}</td></tr>
            ))}</tbody></table>
          )}
      </div>
    </div>
  );
}
