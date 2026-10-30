/** Typed REST client for the control API (same origin in dev via Vite proxy). */
const base = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").replace(/\/$/, "");
export const API_AUTH_REQUIRED_EVENT = "ads:api-auth-required";

function apiKey(): string {
  return localStorage.getItem("ads_api_key") || (import.meta.env.VITE_API_KEY as string | undefined) || "";
}

export function setApiKey(key: string): void {
  localStorage.setItem("ads_api_key", key);
}

async function req<T>(path: string, init?: RequestInit, keyOverride?: string): Promise<T> {
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
    throw new Error(
      contentType.includes("text/html")
        ? "The dashboard received HTML instead of API data. Check the API address and restart the dashboard."
        : `The control API did not return JSON (HTTP ${res.status}). Check that npm run dev:api is running.`,
    );
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const message = error && typeof error === "object" && "message" in error ? error.message : undefined;
    if (res.status === 401 && code === "unauthorized" && keyOverride === undefined && key === apiKey()) {
      // An older in-flight request must not clear a newly saved key.
      localStorage.removeItem("ads_api_key");
      if (typeof window !== "undefined") window.dispatchEvent(new Event(API_AUTH_REQUIRED_EVENT));
    }
    throw new Error(typeof message === "string" ? message : `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Validate against an authenticated, read-only endpoint before saving a key.
  validateApiKey: (key: string) => req<{ items: unknown[] }>("/projects", undefined, key),
  health: () => req<{ ok: boolean; store: string }>("/health"),
  projects: () => req<{ items: ConnectedProject[] }>(`/projects`),
  connectProject: (body: Record<string, unknown>) =>
    req<{ project: ConnectedProject }>("/projects/connect", { method: "POST", body: JSON.stringify(body) }),
  commits: (projectId: string, ref: string, page: number) =>
    req<{ items: ProjectCommit[]; page: number; perPage: number; hasNext: boolean }>(
      `/projects/${encodeURIComponent(projectId)}/commits?${new URLSearchParams({ ref, page: String(page), perPage: "20" })}`),
  runs: (params = "") => req<{ items: RunSummary[] }>(`/runs${params}`),
  createRun: (body: Record<string, unknown>) => req<{ run: RunSummary }>("/runs", { method: "POST", body: JSON.stringify(body) }),
  runDetail: (id: string) => req<RunDetail>(`/runs/${id}`),
  runIssues: (id: string) => req<{ items: Issue[] }>(`/runs/${id}/issues`),
  runIterations: (id: string) => req<{ items: Iteration[] }>(`/runs/${id}/iterations`),
  runTests: (id: string) => req<{ items: TestResult[] }>(`/runs/${id}/test-results`),
  cancelRun: (id: string) => req(`/runs/${id}/cancel`, { method: "POST" }),
  retryRun: (id: string) => req(`/runs/${id}/retry`, { method: "POST" }),
  issue: (id: string) => req<{ issue: Issue }>(`/issues/${id}`),
  environments: () => req<{ items: EnvHealth[] }>(`/environments`),
  deployments: () => req<{ items: Deployment[] }>(`/deployments`),
  approveDeployment: (id: string) => req(`/deployments/${id}/approve`, { method: "POST", body: "{}" }),
  rollbackDeployment: (id: string, toDeploymentId?: string) =>
    req(`/deployments/${id}/rollback`, { method: "POST", body: JSON.stringify({ toDeploymentId }) }),
  metrics: () => req<Metrics>(`/metrics`),
  policies: () => req<{ policy: Record<string, unknown>; environments: Record<string, unknown> }>(`/policies`),
  updatePolicies: (body: Record<string, unknown>) =>
    req(`/policies`, { method: "PUT", body: JSON.stringify(body) }),
  audit: () => req<{ items: unknown[] }>(`/audit`),
};

export interface RunSummary {
  id: string;
  projectId: string;
  ref: string;
  commitSha: string;
  state: string;
  iteration: number;
  stopReason?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface RunDetail extends RunSummary {
  issues: Issue[];
  gates: Array<{ gate: string; passed: boolean; detail: string; required: boolean }>;
  metrics: Record<string, number | string | null>;
}

export interface Issue {
  id: string;
  title: string;
  category: string;
  severity: string;
  state: string;
  filePath?: string;
  lineStart?: number;
  blocksRelease: boolean;
  verificationMethod: string;
  evidence: Array<{ kind: string; description: string }>;
  history: Array<{ at: string; to: string; actor: string; reason: string }>;
}

export interface Iteration {
  iteration: number;
  at: string;
  events: Array<{ at: string; type: string; payload: Record<string, unknown> }>;
}

export interface TestResult {
  suite: string;
  platform: string;
  passed: boolean;
  durationMs: number;
  failureSummary?: string;
  timestamp: string;
}

export interface EnvHealth {
  environment: string;
  status: string;
  lastDeployment?: Deployment;
}

export interface Deployment {
  id: string;
  environment: string;
  status: string;
  artifactDigest: string;
  approvals: Array<{ actor: string; at: string }>;
  healthChecks: Array<{ name: string; ok: boolean; detail: string }>;
  rollbackAvailable: boolean;
  createdAt: string;
}

export interface Metrics {
  runs: number;
  activeRuns: number;
  verifiedFixes: number;
  openCritical: number;
  testPassRate: number | null;
  totalTests: number;
  avgIterations: number | null;
  regressionRate: number | null;
}

/** Subscribe to live run events via SSE (EventSource cannot send headers; token goes in query). */
export function subscribeRunEvents(runId: string, onEvent: (e: { type: string; payload: unknown }) => void): () => void {
  const src = new EventSource(`${base}/api/v1/runs/${runId}/events?token=${encodeURIComponent(apiKey())}`);
  src.addEventListener("run-event", (msg) => {
    try {
      const evt = JSON.parse((msg as MessageEvent).data) as { type: string; payload: unknown };
      onEvent({ type: evt.type, payload: evt.payload });
    } catch {
      /* ignore malformed frames */
    }
  });
  return () => src.close();
}

export interface ConnectedProject {
  id: string;
  name: string;
  pathWithNamespace: string;
  defaultBranch: string;
  webUrl: string;
}
export interface ProjectCommit {
  id: string;
  short_id: string;
  title: string;
  author_name: string;
  created_at: string;
}
