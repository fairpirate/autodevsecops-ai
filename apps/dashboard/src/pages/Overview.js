import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
    if (metrics.isPending)
        return _jsx(Loading, {});
    if (metrics.isError)
        return _jsx(ErrorBox, { message: metrics.error.message, onRetry: () => metrics.refetch() });
    const m = metrics.data;
    const cards = [
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
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsx("h2", { style: { margin: 0 }, children: "Overview" }), _jsx("div", { className: "grid cols-4", children: cards.map(([label, value]) => (_jsxs("div", { className: "card", children: [_jsx("h3", { children: label }), _jsx("div", { className: "big", children: value })] }, label))) }), _jsxs("div", { className: "grid cols-2", children: [_jsxs("div", { className: "card", children: [_jsx("h3", { children: "Iterations per recent run (live data)" }), chart.length === 0 ? (_jsx(Empty, { message: "No runs yet \u2014 connect a project and start a review run." })) : (_jsx(ResponsiveContainer, { width: "100%", height: 220, children: _jsxs(BarChart, { data: chart, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3" }), _jsx(XAxis, { dataKey: "ref" }), _jsx(YAxis, { allowDecimals: false }), _jsx(Tooltip, {}), _jsx(Bar, { dataKey: "iteration" })] }) }))] }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Environment health" }), envs.isPending ? (_jsx(Loading, {})) : envs.isError ? (_jsx(ErrorBox, { message: envs.error.message })) : (_jsx("ul", { children: envs.data.items.map((e) => (_jsxs("li", { children: [e.environment, ": ", e.status, e.lastDeployment ? ` (last: ${e.lastDeployment.status} ${e.lastDeployment.artifactDigest.slice(0, 12)}…)` : " (never deployed)"] }, e.environment))) })), _jsx("h3", { children: "Recent review runs" }), runs.isPending ? (_jsx(Loading, {})) : (_jsx("ul", { children: (runs.data?.items ?? []).map((r) => (_jsxs("li", { children: [_jsxs(Link, { to: `/runs/${r.id}`, children: [r.ref, "@", r.commitSha.slice(0, 8)] }), " \u2014 ", r.state, " (iter ", r.iteration, ")"] }, r.id))) })), _jsx("h3", { children: "Recent deployments" }), deployments.isPending ? (_jsx(Loading, {})) : (_jsx("ul", { children: (deployments.data?.items ?? []).slice(0, 5).map((d) => (_jsxs("li", { children: [d.environment, ": ", d.status, " (", d.artifactDigest.slice(0, 12), "\u2026)"] }, d.id))) }))] })] })] }));
}
//# sourceMappingURL=Overview.js.map