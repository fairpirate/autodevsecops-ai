import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, subscribeRunEvents } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading, Pill } from "../components/Status";
const STEPS = ["CHECKOUT", "ANALYSIS", "ISSUE_TRIAGE", "REPAIR_PLANNING", "PATCH_GENERATION", "TARGETED_TESTS", "FULL_REGRESSION", "INDEPENDENT_REVIEW", "QUALITY_GATE", "NEXT_ITERATION", "READY_FOR_BUILD"];
export function RunDetail() {
    const { id = "" } = useParams();
    const qc = useQueryClient();
    const tick = useUi((s) => s.refreshToken);
    const detail = useQuery({ queryKey: ["run", id, tick], queryFn: () => api.runDetail(id) });
    const iterations = useQuery({ queryKey: ["iterations", id], queryFn: () => api.runIterations(id) });
    const tests = useQuery({ queryKey: ["run-tests", id, tick], queryFn: () => api.runTests(id) });
    const [live, setLive] = useState([]);
    useEffect(() => subscribeRunEvents(id, (e) => {
        setLive((l) => [...l.slice(-49), e]);
        qc.invalidateQueries({ queryKey: ["run", id] });
    }), [id, qc]);
    const cancel = useMutation({ mutationFn: () => api.cancelRun(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["run", id] }) });
    const retry = useMutation({ mutationFn: () => api.retryRun(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["runs"] }) });
    if (detail.isPending)
        return _jsx(Loading, {});
    if (detail.isError)
        return _jsx(ErrorBox, { message: detail.error.message, onRetry: () => detail.refetch() });
    const run = detail.data;
    const activeIdx = STEPS.indexOf(run.state);
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsxs("div", { className: "row", children: [_jsxs("h2", { style: { margin: 0 }, children: ["Run ", run.ref, "@", run.commitSha.slice(0, 8)] }), _jsx(Pill, { value: run.state }), _jsxs("span", { className: "muted", children: ["iteration ", run.iteration, run.stopReason ? ` · ${run.stopReason}` : ""] }), _jsx("span", { style: { flex: 1 } }), _jsx("button", { type: "button", className: "ghost", disabled: cancel.isPending, onClick: () => cancel.mutate(), children: "Cancel" }), _jsx("button", { type: "button", className: "ghost", disabled: retry.isPending, onClick: () => retry.mutate(), children: "Retry as child run" })] }), (cancel.isError || retry.isError) && _jsx("p", { role: "alert", children: (cancel.error ?? retry.error).message }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Workflow timeline (live)" }), _jsx("div", { className: "timeline", children: STEPS.map((s, i) => (_jsxs("div", { className: "step", children: [_jsx("strong", { children: s }), " ", i < activeIdx ? "— done" : i === activeIdx ? "— current" : "— pending"] }, s))) })] }), _jsxs("div", { className: "grid cols-2", children: [_jsxs("div", { className: "card", children: [_jsxs("h3", { children: ["Findings (", run.issues.length, ")"] }), run.issues.length === 0 ? _jsx(Empty, { message: "No findings recorded." }) : (_jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Issue" }), _jsx("th", { children: "Severity" }), _jsx("th", { children: "State" })] }) }), _jsx("tbody", { children: run.issues.map((i) => (_jsxs("tr", { children: [_jsx("td", { children: _jsx(Link, { to: `/issues/${i.id}`, children: i.title }) }), _jsx("td", { children: _jsx(Pill, { value: i.severity }) }), _jsx("td", { children: _jsx(Pill, { value: i.state }) })] }, i.id))) })] })), _jsx("h3", { children: "Quality gates" }), _jsx("ul", { children: run.gates.map((g) => _jsxs("li", { children: [g.gate, ": ", _jsx(Pill, { value: g.passed ? "pass" : "failed" }), " \u2014 ", g.detail] }, g.gate)) }), _jsx("h3", { children: "Metrics" }), _jsx("pre", { className: "logs", children: JSON.stringify(run.metrics, null, 2) })] }), _jsxs("div", { className: "card", children: [_jsxs("h3", { children: ["Test results (", tests.data?.items.length ?? 0, ")"] }), tests.isPending ? _jsx(Loading, {}) : (tests.data?.items ?? []).length === 0 ? _jsx(Empty, { message: "No test results yet." }) : (_jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Suite" }), _jsx("th", { children: "Platform" }), _jsx("th", { children: "Result" }), _jsx("th", { children: "Duration" })] }) }), _jsx("tbody", { children: tests.data.items.map((t, n) => (_jsxs("tr", { children: [_jsx("td", { children: t.suite }), _jsx("td", { children: t.platform }), _jsx("td", { children: _jsx(Pill, { value: t.passed ? "pass" : "failed" }) }), _jsxs("td", { children: [t.durationMs, "ms"] })] }, n))) })] })), _jsx("h3", { children: "Iterations" }), iterations.isPending ? _jsx(Loading, {}) : (_jsx("ul", { children: (iterations.data?.items ?? []).map((it) => _jsxs("li", { children: ["#", it.iteration, " \u00B7 ", it.events.length, " events \u00B7 ", new Date(it.at).toLocaleTimeString()] }, it.iteration)) })), _jsxs("h3", { children: ["Live events (", live.length, ")"] }), _jsx("pre", { className: "logs", "aria-live": "polite", children: live.length === 0 ? "Waiting for live events…" : live.map((e, n) => `${n + 1}. ${e.type}`).join("\n") })] })] })] }));
}
//# sourceMappingURL=RunDetail.js.map