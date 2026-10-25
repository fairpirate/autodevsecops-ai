/** Typed REST client for the control API (same origin in dev via Vite proxy). */
const base = import.meta.env.VITE_API_BASE_URL ?? "";
function apiKey() {
    return import.meta.env.VITE_API_KEY ?? localStorage.getItem("ads_api_key") ?? "";
}
export function setApiKey(key) {
    localStorage.setItem("ads_api_key", key);
}
async function req(path, init) {
    const res = await fetch(`${base}/api/v1${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey()}`,
            ...(init?.headers ?? {}),
        },
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
    }
    return res.json();
}
export const api = {
    health: () => req("/health"),
    projects: () => req(`/projects`),
    connectProject: (body) => req("/projects/connect", { method: "POST", body: JSON.stringify(body) }),
    runs: (params = "") => req(`/runs${params}`),
    createRun: (body) => req("/runs", { method: "POST", body: JSON.stringify(body) }),
    runDetail: (id) => req(`/runs/${id}`),
    runIssues: (id) => req(`/runs/${id}/issues`),
    runIterations: (id) => req(`/runs/${id}/iterations`),
    runTests: (id) => req(`/runs/${id}/test-results`),
    cancelRun: (id) => req(`/runs/${id}/cancel`, { method: "POST" }),
    retryRun: (id) => req(`/runs/${id}/retry`, { method: "POST" }),
    issue: (id) => req(`/issues/${id}`),
    environments: () => req(`/environments`),
    deployments: () => req(`/deployments`),
    approveDeployment: (id) => req(`/deployments/${id}/approve`, { method: "POST", body: "{}" }),
    rollbackDeployment: (id, toDeploymentId) => req(`/deployments/${id}/rollback`, { method: "POST", body: JSON.stringify({ toDeploymentId }) }),
    metrics: () => req(`/metrics`),
    policies: () => req(`/policies`),
    updatePolicies: (body) => req(`/policies`, { method: "PUT", body: JSON.stringify(body) }),
    audit: () => req(`/audit`),
};
/** Subscribe to live run events via SSE (EventSource cannot send headers; token goes in query). */
export function subscribeRunEvents(runId, onEvent) {
    const src = new EventSource(`${base}/api/v1/runs/${runId}/events?token=${encodeURIComponent(apiKey())}`);
    src.addEventListener("run-event", (msg) => {
        try {
            const evt = JSON.parse(msg.data);
            onEvent({ type: evt.type, payload: evt.payload });
        }
        catch {
            /* ignore malformed frames */
        }
    });
    return () => src.close();
}
//# sourceMappingURL=api.js.map