import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsx("h2", { style: { margin: 0 }, children: "Test Results" }), _jsx("div", { className: "card", children: _jsxs("label", { children: ["Review run ", _jsxs("select", { "aria-label": "Review run", value: runId, onChange: (e) => setRunId(e.target.value), children: [_jsx("option", { value: "", children: "select a run\u2026" }), (runs.data?.items ?? []).map((r) => _jsxs("option", { value: r.id, children: [r.ref, "@", r.commitSha.slice(0, 8), " \u2014 ", r.state] }, r.id))] })] }) }), _jsx("div", { className: "card", children: !runId ? _jsx(Empty, { message: "Select a run to view structured test evidence (suite, platform, pass/fail, duration, logs)." }) :
                    tests.isPending ? _jsx(Loading, {}) : tests.isError ? _jsx(ErrorBox, { message: tests.error.message, onRetry: () => tests.refetch() }) :
                        tests.data.items.length === 0 ? _jsx(Empty, { message: "No test results recorded." }) : (_jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Suite" }), _jsx("th", { children: "Platform" }), _jsx("th", { children: "Result" }), _jsx("th", { children: "Duration" }), _jsx("th", { children: "Failure summary" }), _jsx("th", { children: "Timestamp" })] }) }), _jsx("tbody", { children: tests.data.items.map((t, n) => (_jsxs("tr", { children: [_jsx("td", { children: t.suite }), _jsx("td", { children: t.platform }), _jsx("td", { children: _jsx(Pill, { value: t.passed ? "pass" : "failed" }) }), _jsxs("td", { children: [t.durationMs, "ms"] }), _jsx("td", { children: t.failureSummary ?? "—" }), _jsx("td", { children: new Date(t.timestamp).toLocaleString() })] }, n))) })] })) })] }));
}
//# sourceMappingURL=TestResults.js.map