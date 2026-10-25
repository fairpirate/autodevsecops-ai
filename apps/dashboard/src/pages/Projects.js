import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Empty, ErrorBox, Loading } from "../components/Status";
export function Projects() {
    const qc = useQueryClient();
    const list = useQuery({ queryKey: ["projects"], queryFn: () => api.projects() });
    const [form, setForm] = useState({ gitlabBaseUrl: "https://gitlab.com", gitlabProjectId: "", token: "" });
    const connect = useMutation({
        mutationFn: () => api.connectProject({
            gitlabBaseUrl: form.gitlabBaseUrl,
            gitlabProjectId: form.gitlabProjectId ? Number(form.gitlabProjectId) : undefined,
            token: form.token,
        }),
        onSuccess: () => {
            setForm((f) => ({ ...f, token: "" }));
            qc.invalidateQueries({ queryKey: ["projects"] });
        },
    });
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsx("h2", { style: { margin: 0 }, children: "Projects" }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Connect a GitLab project" }), _jsxs("div", { className: "row", children: [_jsx("input", { "aria-label": "GitLab base URL", value: form.gitlabBaseUrl, onChange: (e) => setForm({ ...form, gitlabBaseUrl: e.target.value }), style: { minWidth: 220 } }), _jsx("input", { "aria-label": "GitLab project ID", value: form.gitlabProjectId, onChange: (e) => setForm({ ...form, gitlabProjectId: e.target.value }), placeholder: "Project ID (e.g. 123)" }), _jsx("input", { "aria-label": "Access token", type: "password", value: form.token, onChange: (e) => setForm({ ...form, token: e.target.value }), placeholder: "glpat-\u2026", style: { minWidth: 220 } }), _jsx("button", { type: "button", disabled: !form.token || connect.isPending, onClick: () => connect.mutate(), children: connect.isPending ? "Connecting…" : "Connect" })] }), connect.isError && _jsx("p", { role: "alert", children: connect.error.message }), connect.isSuccess && _jsx("p", { className: "muted", children: "Connected \u2014 token stored encrypted, never logged." })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Connected projects" }), list.isPending ? _jsx(Loading, {}) : list.isError ? _jsx(ErrorBox, { message: list.error.message, onRetry: () => list.refetch() }) : list.data.items.length === 0 ? _jsx(Empty, { message: "No projects connected yet." }) : (_jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Name" }), _jsx("th", { children: "Path" }), _jsx("th", { children: "Default branch" }), _jsx("th", { children: "URL" })] }) }), _jsx("tbody", { children: list.data.items.map((p) => (_jsxs("tr", { children: [_jsx("td", { children: p.name }), _jsx("td", { children: p.pathWithNamespace }), _jsx("td", { children: p.defaultBranch }), _jsx("td", { children: _jsx("a", { href: p.webUrl, target: "_blank", rel: "noreferrer", children: "open" }) })] }, p.id))) })] }))] })] }));
}
//# sourceMappingURL=Projects.js.map