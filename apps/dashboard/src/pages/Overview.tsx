import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading } from "../components/Status";

export function Overview() {
  const tick = useUi((s) => s.refreshToken);
  const metrics = useQuery({ queryKey: ["metrics", tick], queryFn: () => api.metrics() });
  const runs = useQuery({ queryKey: ["runs-recent", tick], queryFn: () => api.runs("?perPage=5") });
  const envs = useQuery({ queryKey: ["envs", tick], queryFn: () => api.environments() });
  const deployments = useQuery({ queryKey: ["deployments-recent", tick], queryFn: () => api.deployments() });

  if (metrics.isPending) return <Loading />;
  if (metrics.isError) return <ErrorBox message={(metrics.error as Error).message} onRetry={() => metrics.refetch()} />;

  const m = metrics.data;
  const cards: Array<[string, string]> = [
    ["Review runs", String(m.runs)],
    ["Active runs", String(m.activeRuns)],
    ["Verified fixes", String(m.verifiedFixes)],
    ["Open critical issues", String(m.openCritical)],
    ["Test pass rate", m.testPassRate == null ? "n/a" : `${(m.testPassRate * 100).toFixed(1)}%`],
    ["Avg iterations / successful repair", m.avgIterations == null ? "n/a" : m.avgIterations.toFixed(1)],
    ["Regression rate", m.regressionRate == null ? "n/a" : `${(m.regressionRate * 100).toFixed(1)}%`],
    ["Total tests executed", String(m.totalTests)],
  ];
  const chart = (runs.data?.items ?? []).slice(0, 8).map((r) => ({ ref: r.ref.slice(0, 12), iteration: r.iteration }));

  return (
    <div className="grid" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>Overview</h2>
      <div className="grid cols-4">
        {cards.map(([label, value]) => (
          <div className="card" key={label}>
            <h3>{label}</h3>
            <div className="big">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid cols-2">
        <div className="card">
          <h3>Iterations per recent run (live data)</h3>
          {chart.length === 0 ? (
            <Empty message="No runs yet — connect a project and start a review run." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ref" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="iteration" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="card">
          <h3>Environment health</h3>
          {envs.isPending ? (
            <Loading />
          ) : envs.isError ? (
            <ErrorBox message={(envs.error as Error).message} />
          ) : (
            <ul>
              {envs.data.items.map((e) => (
                <li key={e.environment}>
                  {e.environment}: {e.status}
                  {e.lastDeployment ? ` (last: ${e.lastDeployment.status} ${e.lastDeployment.artifactDigest.slice(0, 12)}…)` : " (never deployed)"}
                </li>
              ))}
            </ul>
          )}
          <h3>Recent review runs</h3>
          {runs.isPending ? (
            <Loading />
          ) : (
            <ul>
              {(runs.data?.items ?? []).map((r) => (
                <li key={r.id}>
                  <Link to={`/runs/${r.id}`}>{r.ref}@{r.commitSha.slice(0, 8)}</Link> — {r.state} (iter {r.iteration})
                </li>
              ))}
            </ul>
          )}
          <h3>Recent deployments</h3>
          {deployments.isPending ? (
            <Loading />
          ) : (
            <ul>
              {(deployments.data?.items ?? []).slice(0, 5).map((d) => (
                <li key={d.id}>
                  {d.environment}: {d.status} ({d.artifactDigest.slice(0, 12)}…)
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
