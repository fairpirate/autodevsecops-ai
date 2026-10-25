import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
    if (runs.isPending)
        return _jsx(Loading, {});
    if (runs.isError)
        return _jsx(ErrorBox, { message: runs.error.message, onRetry: () => runs.refetch() });
    const rows = (details.data ?? []).flatMap((d) => d.issues.filter((i) => ["repair_attempted", "awaiting_verification", "verified_fixed", "reopened", "blocked"].includes(i.state))
        .map((i) => ({ run: d, issue: i })));
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsx("h2", { style: { margin: 0 }, children: "AI Repair History" }), _jsx("div", { className: "card", children: rows.length === 0 ? _jsx(Empty, { message: "No repair attempts yet." }) : (_jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Run" }), _jsx("th", { children: "Issue" }), _jsx("th", { children: "State" }), _jsx("th", { children: "Verification" })] }) }), _jsx("tbody", { children: rows.map(({ run, issue }) => (_jsxs("tr", { children: [_jsxs("td", { children: [run.ref, "@", run.commitSha.slice(0, 8)] }), _jsx("td", { children: issue.title }), _jsx("td", { children: _jsx(Pill, { value: issue.state }) }), _jsx("td", { children: issue.state === "verified_fixed" ? "independent-verification-agent ✓" : "pending / rejected" })] }, `${run.id}-${issue.id}`))) })] })) })] }));
}
//# sourceMappingURL=Repairs.js.map