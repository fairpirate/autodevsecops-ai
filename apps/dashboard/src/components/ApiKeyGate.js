import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { setApiKey } from "../api";
import { useUi } from "../store";
export function ApiKeyGate() {
    const apiKeySet = useUi((s) => s.apiKeySet);
    const markApiKeySet = useUi((s) => s.markApiKeySet);
    const [key, setKey] = useState("");
    if (apiKeySet)
        return null;
    return (_jsxs("div", { className: "card", role: "alert", style: { marginBottom: 16 }, children: [_jsx("h3", { children: "API key required" }), _jsx("p", { className: "muted", children: "Enter a control-API key (see API_KEYS in .env.example). Stored only in localStorage." }), _jsxs("div", { className: "row", children: [_jsx("input", { "aria-label": "API key", type: "password", value: key, onChange: (e) => setKey(e.target.value), placeholder: "dev-admin-key-change-me", style: { minWidth: 280 } }), _jsx("button", { type: "button", disabled: !key.trim(), onClick: () => {
                            setApiKey(key.trim());
                            markApiKeySet();
                        }, children: "Save key" })] })] }));
}
//# sourceMappingURL=ApiKeyGate.js.map