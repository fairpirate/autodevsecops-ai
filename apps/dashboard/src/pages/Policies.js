import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { ErrorBox, Loading } from "../components/Status";
/** Policy + environment-rules editor (quality gates, approval requirements, promotion chain). */
export function Policies() {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ["policies"], queryFn: () => api.policies() });
    const [text, setText] = useState("");
    const save = useMutation({
        mutationFn: () => api.updatePolicies(JSON.parse(text)),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["policies"] }),
    });
    if (q.isPending)
        return _jsx(Loading, {});
    if (q.isError)
        return _jsx(ErrorBox, { message: q.error.message, onRetry: () => q.refetch() });
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsx("h2", { style: { margin: 0 }, children: "Policies" }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Current policy (read-only view)" }), _jsx("pre", { className: "logs", children: JSON.stringify(q.data, null, 2) })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Update policy (admin)" }), _jsxs("p", { className: "muted", children: ["Paste a JSON object like ", "{ \"requiredSuites\": [\"server:unit\"], \"forbidCritical\": true }", ". Security findings are never auto-suppressed; critical/high follow these gates."] }), _jsx("textarea", { "aria-label": "Policy JSON", rows: 6, style: { width: "100%" }, value: text, onChange: (e) => setText(e.target.value), placeholder: '{"requiredSuites": ["server:unit"]}' }), _jsx("div", { className: "row", style: { marginTop: 8 }, children: _jsx("button", { type: "button", disabled: !text.trim() || save.isPending, onClick: () => save.mutate(), children: save.isPending ? "Saving…" : "Save policy" }) }), save.isError && _jsx("p", { role: "alert", children: save.error.message }), save.isSuccess && _jsx("p", { className: "muted", children: "Policy updated and audited." })] })] }));
}
//# sourceMappingURL=Policies.js.map