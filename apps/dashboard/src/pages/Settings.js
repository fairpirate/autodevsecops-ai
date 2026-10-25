import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { ErrorBox, Loading } from "../components/Status";
export function Settings() {
    const audit = useQuery({ queryKey: ["audit"], queryFn: () => api.audit() });
    const health = useQuery({ queryKey: ["health"], queryFn: () => api.health() });
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsx("h2", { style: { margin: 0 }, children: "Settings" }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Control API health" }), health.isPending ? _jsx(Loading, {}) : health.isError ? _jsx(ErrorBox, { message: health.error.message }) : (_jsx("pre", { className: "logs", children: JSON.stringify(health.data, null, 2) })), _jsx("p", { className: "muted", children: "Tokens are encrypted at rest (AES-256-GCM), redacted in logs, and never sent to AI agents. Budget env vars: MAX_ITERATIONS, MAX_RUNTIME_MINUTES, MAX_TOKEN_BUDGET, MAX_PATCH_SIZE_LINES, MIN_VERIFICATION_CONFIDENCE." })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { children: "Audit log" }), audit.isPending ? _jsx(Loading, {}) : audit.isError ? _jsx(ErrorBox, { message: audit.error.message }) : (_jsx("pre", { className: "logs", children: JSON.stringify(audit.data.items, null, 2) }))] })] }));
}
//# sourceMappingURL=Settings.js.map