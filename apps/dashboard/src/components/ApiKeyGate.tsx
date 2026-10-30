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

  async function saveKey(): Promise<void> {
    setSaving(true);
    setError("");
    try {
      const candidate = key.trim();
      await api.validateApiKey(candidate);
      setApiKey(candidate);
      markApiKeySet();
      setKey("");
      await queryClient.resetQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not validate the dashboard API key.");
    } finally {
      setSaving(false);
    }
  }

  if (apiKeySet) return (
    <div style={{ marginBottom: 16 }}>
      <button type="button" className="ghost" onClick={() => { setError(""); requireApiKey(); }}>
        Change dashboard API key
      </button>
    </div>
  );
  return (
    <div className="card" role="alert" style={{ marginBottom: 16 }}>
      <h3>Dashboard API key required</h3>
      <p className="muted">Use a key from API_KEYS in the running backend's .env, entering only the value before :admin, :engineer, or :viewer. Your GitLab access token goes in the project connection form.</p>
      <form className="row" onSubmit={(event) => { event.preventDefault(); if (key.trim() && !saving) void saveKey(); }}>
        <input
          aria-label="Dashboard API key"
          type="password"
          autoComplete="off"
          disabled={saving}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="dev-admin-key-change-me"
          style={{ minWidth: 280 }}
        />
        <button
          type="submit"
          disabled={!key.trim() || saving}
        >
          {saving ? "Checking key…" : "Validate and save key"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
