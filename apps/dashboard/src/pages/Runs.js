import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading, Pill } from "../components/Status";
export function Runs() {
    const qc = useQueryClient();
    const tick = useUi((s) => s.refreshToken);
    const [filter, setFilter] = useState("");
    const list = useQuery({ queryKey: ["runs", filter, tick], queryFn: () => api.runs(filter ? `?state=${filter}` : "") });
    const create = useMutation({
        mutationFn: (body) => api.createRun(body),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["runs"] }),
    });
    const [form, setForm] = useState({ projectId: "", ref: "main", commitSha: "" });
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsx("h2", { style: { margin: 0 }, children: "Review Runs" }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Start a review run" }), _jsxs("div", { className: "row", children: [_jsx("input", { "aria-label": "Project ID", placeholder: "project id", value: form.projectId, onChange: (e) => setForm({ ...form, projectId: e.target.value }) }), _jsx("input", { "aria-label": "Ref", placeholder: "ref", value: form.ref, onChange: (e) => setForm({ ...form, ref: e.target.value }) }), _jsx("input", { "aria-label": "Commit SHA", placeholder: "commit sha", value: form.commitSha, onChange: (e) => setForm({ ...form, commitSha: e.target.value }), style: { minWidth: 260 } }), _jsx("button", { type: "button", disabled: !form.projectId || !form.commitSha || create.isPending, onClick: () => create.mutate(form), children: create.isPending ? "Starting…" : "Start run" })] }), create.isError && _jsx("p", { role: "alert", children: create.error.message })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "row", children: _jsxs("label", { children: ["Filter by state ", _jsxs("select", { "aria-label": "State filter", value: filter, onChange: (e) => setFilter(e.target.value), children: [_jsx("option", { value: "", children: "all" }), ["INITIALIZED", "CHECKOUT", "ANALYSIS", "ISSUE_TRIAGE", "REPAIR_PLANNING", "PATCH_GENERATION", "TARGETED_TESTS", "FULL_REGRESSION", "INDEPENDENT_REVIEW", "QUALITY_GATE", "NEXT_ITERATION", "READY_FOR_BUILD", "BLOCKED", "FAILED", "CANCELLED", "NEEDS_HUMAN_REVIEW"].map((s) => _jsx("option", { value: s, children: s }, s))] })] }) }), list.isPending ? _jsx(Loading, {}) : list.isError ? _jsx(ErrorBox, { message: list.error.message, onRetry: () => list.refetch() }) : list.data.items.length === 0 ? _jsx(Empty, { message: "No runs yet." }) : (_jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Run" }), _jsx("th", { children: "State" }), _jsx("th", { children: "Iter" }), _jsx("th", { children: "Stop reason" }), _jsx("th", { children: "Updated" })] }) }), _jsx("tbody", { children: list.data.items.map((r) => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs(Link, { to: `/runs/${r.id}`, children: [r.ref, "@", r.commitSha.slice(0, 8)] }) }), _jsx("td", { children: _jsx(Pill, { value: r.state }) }), _jsx("td", { children: r.iteration }), _jsx("td", { children: r.stopReason ?? "—" }), _jsx("td", { children: new Date(r.updatedAt).toLocaleString() })] }, r.id))) })] }))] })] }));
}
//# sourceMappingURL=Runs.js.map