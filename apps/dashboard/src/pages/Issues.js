import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading, Pill } from "../components/Status";
export function Issues() {
    const tick = useUi((s) => s.refreshToken);
    const runs = useQuery({ queryKey: ["runs-all", tick], queryFn: () => api.runs("?perPage=50") });
    const [runId, setRunId] = useState("");
    const issues = useQuery({ queryKey: ["issues", runId], queryFn: () => api.runIssues(runId), enabled: Boolean(runId) });
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsx("h2", { style: { margin: 0 }, children: "Issues" }), _jsx("div", { className: "card", children: _jsxs("label", { children: ["Review run ", _jsxs("select", { "aria-label": "Review run", value: runId, onChange: (e) => setRunId(e.target.value), children: [_jsx("option", { value: "", children: "select a run\u2026" }), (runs.data?.items ?? []).map((r) => _jsxs("option", { value: r.id, children: [r.ref, "@", r.commitSha.slice(0, 8), " \u2014 ", r.state] }, r.id))] })] }) }), _jsx("div", { className: "card", children: !runId ? _jsx(Empty, { message: "Select a review run to list its issue ledger." }) :
                    issues.isPending ? _jsx(Loading, {}) : issues.isError ? _jsx(ErrorBox, { message: issues.error.message, onRetry: () => issues.refetch() }) :
                        issues.data.items.length === 0 ? _jsx(Empty, { message: "No issues for this run." }) : (_jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Issue" }), _jsx("th", { children: "Category" }), _jsx("th", { children: "Severity" }), _jsx("th", { children: "State" }), _jsx("th", { children: "File" })] }) }), _jsx("tbody", { children: issues.data.items.map((i) => (_jsxs("tr", { children: [_jsx("td", { children: _jsx(Link, { to: `/issues/${i.id}`, children: i.title }) }), _jsx("td", { children: i.category }), _jsx("td", { children: _jsx(Pill, { value: i.severity }) }), _jsx("td", { children: _jsx(Pill, { value: i.state }) }), _jsx("td", { children: i.filePath ?? "—" })] }, i.id))) })] })) })] }));
}
//# sourceMappingURL=Issues.js.map