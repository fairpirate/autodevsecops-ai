import { useState } from "react";
import { setApiKey } from "../api";
import { useUi } from "../store";

export function ApiKeyGate() {
  const apiKeySet = useUi((s) => s.apiKeySet);
  const markApiKeySet = useUi((s) => s.markApiKeySet);
  const [key, setKey] = useState("");
  if (apiKeySet) return null;
  return (
    <div className="card" role="alert" style={{ marginBottom: 16 }}>
      <h3>API key required</h3>
      <p className="muted">Enter a control-API key (see API_KEYS in .env.example). Stored only in localStorage.</p>
      <div className="row">
        <input
          aria-label="API key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="dev-admin-key-change-me"
          style={{ minWidth: 280 }}
        />
        <button
          type="button"
          disabled={!key.trim()}
          onClick={() => {
            setApiKey(key.trim());
            markApiKeySet();
          }}
        >
          Save key
        </button>
      </div>
    </div>
  );
}
