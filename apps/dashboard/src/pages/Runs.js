import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useUi } from "../store";
import { Empty, ErrorBox, Loading, Pill } from "../components/Status";
export function Runs() {
    const qc = useQueryClient();
    const tick = useUi((s) => s.refreshToken);
    const [filter, setFilter] = useState("");
    const list = useQuery({ queryKey: ["runs", filter, tick], queryFn: () => api.runs(filter ? `?state=${filter}` : "") });
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.projects() });
    const projectId = params.get("projectId") ?? projects.data?.items[0]?.id ?? "";
    const project = projects.data?.items.find((p) => p.id === projectId);
    const create = useMutation({
        mutationFn: (body) => api.createRun(body),
        onSuccess: ({ run }) => {
            void qc.invalidateQueries({ queryKey: ["runs"] });
            navigate(`/runs/${run.id}`);
        },
    });
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsx("h2", { style: { margin: 0 }, children: "Review Runs" }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Start a review run" }), projects.isPending ? _jsx(Loading, {}) : projects.isError ? (_jsx(ErrorBox, { message: projects.error.message, onRetry: () => projects.refetch() })) : projects.data.items.length === 0 ? (_jsxs("p", { children: [_jsx(Link, { to: "/projects", children: "Connect a GitLab project" }), " to review its commits."] })) : _jsxs(_Fragment, { children: [_jsxs("label", { children: ["Connected project ", _jsxs("select", { "aria-label": "Connected project", value: projectId, disabled: create.isPending, onChange: (e) => { setParams({ projectId: e.target.value }); create.reset(); }, children: [_jsx("option", { value: "", disabled: true, children: "Select a project" }), projects.data.items.map((p) => _jsx("option", { value: p.id, children: p.pathWithNamespace }, p.id))] })] }), project ? _jsx(CommitPicker, { projectId: project.id, defaultBranch: project.defaultBranch, pending: create.isPending, onStart: (ref, commitSha) => create.mutate({ projectId: project.id, ref, commitSha }) }, project.id)
                                : _jsx(Empty, { message: "Choose a connected project to load commits." })] }), create.isError && _jsx("p", { role: "alert", children: create.error.message })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "row", children: _jsxs("label", { children: ["Filter by state ", _jsxs("select", { "aria-label": "State filter", value: filter, onChange: (e) => setFilter(e.target.value), children: [_jsx("option", { value: "", children: "all" }), ["INITIALIZED", "CHECKOUT", "ANALYSIS", "ISSUE_TRIAGE", "REPAIR_PLANNING", "PATCH_GENERATION", "TARGETED_TESTS", "FULL_REGRESSION", "INDEPENDENT_REVIEW", "QUALITY_GATE", "NEXT_ITERATION", "READY_FOR_BUILD", "BLOCKED", "FAILED", "CANCELLED", "NEEDS_HUMAN_REVIEW"].map((s) => _jsx("option", { value: s, children: s }, s))] })] }) }), list.isPending ? _jsx(Loading, {}) : list.isError ? _jsx(ErrorBox, { message: list.error.message, onRetry: () => list.refetch() }) : list.data.items.length === 0 ? _jsx(Empty, { message: "No runs yet." }) : (_jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Run" }), _jsx("th", { children: "State" }), _jsx("th", { children: "Iter" }), _jsx("th", { children: "Stop reason" }), _jsx("th", { children: "Updated" })] }) }), _jsx("tbody", { children: list.data.items.map((r) => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs(Link, { to: `/runs/${r.id}`, children: [r.ref, "@", r.commitSha.slice(0, 8)] }) }), _jsx("td", { children: _jsx(Pill, { value: r.state }) }), _jsx("td", { children: r.iteration }), _jsx("td", { children: r.stopReason ?? "—" }), _jsx("td", { children: new Date(r.updatedAt).toLocaleString() })] }, r.id))) })] }))] })] }));
}
function CommitPicker({ projectId, defaultBranch, pending, onStart }) {
    const [ref, setRef] = useState(defaultBranch || "main");
    const [draftRef, setDraftRef] = useState(ref);
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState("");
    const commits = useQuery({
        queryKey: ["project-commits", projectId, ref, page],
        queryFn: () => api.commits(projectId, ref, page),
    });
    const changePage = (next) => { setSelected(""); setPage(next); };
    const canStart = !pending && !commits.isFetching && !commits.isError
        && commits.data?.items.some((c) => c.id === selected);
    return _jsxs("div", { className: "grid", style: { gap: 12, marginTop: 16 }, children: [_jsxs("form", { className: "row", onSubmit: (e) => {
                    e.preventDefault();
                    if (!draftRef.trim() || pending)
                        return;
                    setSelected("");
                    setPage(1);
                    setRef(draftRef.trim());
                }, children: [_jsxs("label", { children: ["Branch or tag ", _jsx("input", { "aria-label": "Branch or tag", value: draftRef, disabled: pending, onChange: (e) => setDraftRef(e.target.value) })] }), _jsx("button", { disabled: pending || !draftRef.trim(), type: "submit", children: "Load commits" })] }), _jsxs("p", { className: "muted", children: ["Select a commit on ", ref, " to review that exact revision."] }), commits.isPending ? _jsx(Loading, {}) : commits.isError ?
                _jsx(ErrorBox, { message: commits.error.message, onRetry: () => commits.refetch() }) :
                commits.data.items.length === 0 ? _jsx(Empty, { message: "No commits on this page. Try a previous page or another branch." }) :
                    _jsx("div", { style: { overflowX: "auto" }, children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Select" }), _jsx("th", { children: "Commit" }), _jsx("th", { children: "Message" }), _jsx("th", { children: "Author" }), _jsx("th", { children: "Date" })] }) }), _jsx("tbody", { children: commits.data.items.map((c) => _jsxs("tr", { children: [_jsx("td", { children: _jsx("input", { type: "radio", name: "review-commit", "aria-label": `Review commit ${c.short_id}: ${c.title}`, checked: selected === c.id, disabled: pending || commits.isFetching, onChange: () => setSelected(c.id) }) }), _jsx("td", { children: _jsx("code", { title: c.id, children: c.short_id }) }), _jsx("td", { children: c.title }), _jsx("td", { children: c.author_name }), _jsx("td", { children: new Date(c.created_at).toLocaleString() })] }, c.id)) })] }) }), _jsxs("div", { className: "row", children: [_jsx("button", { type: "button", disabled: page === 1 || pending || commits.isFetching, onClick: () => changePage(page - 1), children: "Previous" }), _jsxs("span", { children: ["Page ", page] }), _jsx("button", { type: "button", disabled: !commits.data?.hasNext || commits.isError || pending || commits.isFetching, onClick: () => changePage(page + 1), children: "Next" }), _jsx("button", { type: "button", disabled: !canStart, onClick: () => onStart(ref, selected), children: pending ? "Starting…" : "Run review" })] })] });
}
//# sourceMappingURL=Runs.js.map