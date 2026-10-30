/** Typed REST client for the control API (same origin in dev via Vite proxy). */
const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
export const API_AUTH_REQUIRED_EVENT = "ads:api-auth-required";
function apiKey() {
    return localStorage.getItem("ads_api_key") || import.meta.env.VITE_API_KEY || "";
}
export function setApiKey(key) {
    localStorage.setItem("ads_api_key", key);
}
async function req(path, init, keyOverride) {
    const key = keyOverride ?? apiKey();
    const res = await fetch(`${base}/api/v1${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            ...(init?.headers ?? {}),
        },
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json") && !contentType.includes("+json")) {
        throw new Error(contentType.includes("text/html")
            ? "The dashboard received HTML instead of API data. Check the API address and restart the dashboard."
            : `The control API did not return JSON (HTTP ${res.status}). Check that npm run dev:api is running.`);
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        const message = error && typeof error === "object" && "message" in error ? error.message : undefined;
        if (res.status === 401 && code === "unauthorized" && keyOverride === undefined && key === apiKey()) {
            // An older in-flight request must not clear a newly saved key.
            localStorage.removeItem("ads_api_key");
            if (typeof window !== "undefined")
                window.dispatchEvent(new Event(API_AUTH_REQUIRED_EVENT));
        }
        throw new Error(typeof message === "string" ? message : `HTTP ${res.status}`);
    }
    return res.json();
}
export const api = {
    // Validate against an authenticated, read-only endpoint before saving a key.
    validateApiKey: (key) => req("/projects", undefined, key),
    health: () => req("/health"),
    projects: () => req(`/projects`),
    connectProject: (body) => req("/projects/connect", { method: "POST", body: JSON.stringify(body) }),
    commits: (projectId, ref, page) => req(`/projects/${encodeURIComponent(projectId)}/commits?${new URLSearchParams({ ref, page: String(page), perPage: "20" })}`),
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