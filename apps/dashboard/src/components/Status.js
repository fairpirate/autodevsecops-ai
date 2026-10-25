import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { statePill } from "../store";
export function Pill({ value }) {
    const cls = statePill(value);
    return _jsx("span", { className: cls ? `pill ${cls}` : "pill", children: value });
}
export function Loading({ label = "Loading…" }) {
    return (_jsx("p", { className: "muted", role: "status", children: label }));
}
export function ErrorBox({ message, onRetry }) {
    return (_jsxs("div", { className: "card", role: "alert", children: [_jsx("p", { children: message }), onRetry && (_jsx("button", { type: "button", className: "ghost", onClick: onRetry, children: "Retry" }))] }));
}
export function Empty({ message }) {
    return _jsx("p", { className: "muted", children: message });
}
//# sourceMappingURL=Status.js.map