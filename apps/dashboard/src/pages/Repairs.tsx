import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading, Pill } from "../components/Status";

/** Repair + verification history across recent runs (independent reviewer evidence). */
export function Repairs() {
  const tick = useUi((s) => s.refreshToken);
  const runs = useQuery({ queryKey: ["runs-repairs", tick], queryFn: () => api.runs("?perPage=20") });
  const details = useQuery({
    queryKey: ["repairs-detail", (runs.data?.items ?? []).map((r) => r.id).join(",")],
    queryFn: async () => Promise.all((runs.data?.items ?? []).map((r) => api.runDetail(r.id))),
    enabled: Boolean(runs.data?.items.length),
  });

  if (runs.isPending) return <Loading />;
  if (runs.isError) return <ErrorBox message={(runs.error as Error).message} onRetry={() => runs.refetch()} />;
  const rows = (details.data ?? []).flatMap((d) =>
    d.issues.filter((i) => ["repair_attempted", "awaiting_verification", "verified_fixed", "reopened", "blocked"].includes(i.state))
      .map((i) => ({ run: d.run, issue: i })),
  );

  return (
    <div className="grid" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>AI Repair History</h2>
      <div className="card">
        {rows.length === 0 ? <Empty message="No repair attempts yet." /> : (
          <table><thead><tr><th>Run</th><th>Issue</th><th>State</th><th>Verification</th></tr></thead>
          <tbody>{rows.map(({ run, issue }) => (
            <tr key={`${run.id}-${issue.id}`}>
              <td>{run.ref}@{run.commitSha.slice(0, 8)}</td>
              <td>{issue.title}</td>
              <td><Pill value={issue.state} /></td>
              <td>{issue.state === "verified_fixed" ? "independent-verification-agent ✓" : "pending / rejected"}</td>
            </tr>
          ))}</tbody></table>
        )}
      </div>
    </div>
  );
}
