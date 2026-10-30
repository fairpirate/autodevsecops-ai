import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_AUTH_REQUIRED_EVENT, api, setApiKey } from "../api";
import { useUi } from "../store";
export function ApiKeyGate() {
    const apiKeySet = useUi((s) => s.apiKeySet);
    const markApiKeySet = useUi((s) => s.markApiKeySet);
    const requireApiKey = useUi((s) => s.requireApiKey);
    const queryClient = useQueryClient();
    const [key, setKey] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        const onUnauthorized = () => {
            requireApiKey();
            setError("Your dashboard API key was rejected. Enter the key from API_KEYS on the running backend.");
        };
        window.addEventListener(API_AUTH_REQUIRED_EVENT, onUnauthorized);
        return () => window.removeEventListener(API_AUTH_REQUIRED_EVENT, onUnauthorized);
    }, [requireApiKey]);
    async function saveKey() {
        setSaving(true);
        setError("");
        try {
            const candidate = key.trim();
            await api.validateApiKey(candidate);
            setApiKey(candidate);
            markApiKeySet();
            setKey("");
            await queryClient.resetQueries();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Could not validate the dashboard API key.");
        }
        finally {
            setSaving(false);
        }
    }
    if (apiKeySet)
        return (_jsx("div", { style: { marginBottom: 16 }, children: _jsx("button", { type: "button", className: "ghost", onClick: () => { setError(""); requireApiKey(); }, children: "Change dashboard API key" }) }));
    return (_jsxs("div", { className: "card", role: "alert", style: { marginBottom: 16 }, children: [_jsx("h3", { children: "Dashboard API key required" }), _jsx("p", { className: "muted", children: "Use a key from API_KEYS in the running backend's .env, entering only the value before :admin, :engineer, or :viewer. Your GitLab access token goes in the project connection form." }), _jsxs("form", { className: "row", onSubmit: (event) => { event.preventDefault(); if (key.trim() && !saving)
                    void saveKey(); }, children: [_jsx("input", { "aria-label": "Dashboard API key", type: "password", autoComplete: "off", disabled: saving, value: key, onChange: (e) => setKey(e.target.value), placeholder: "dev-admin-key-change-me", style: { minWidth: 280 } }), _jsx("button", { type: "submit", disabled: !key.trim() || saving, children: saving ? "Checking key…" : "Validate and save key" })] }), error && _jsx("p", { role: "alert", children: error })] }));
}
//# sourceMappingURL=ApiKeyGate.js.map