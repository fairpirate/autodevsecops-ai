export declare function setApiKey(key: string): void;
export declare const api: {
    health: () => Promise<{
        ok: boolean;
        store: string;
    }>;
    projects: () => Promise<{
        items: unknown[];
    }>;
    connectProject: (body: Record<string, unknown>) => Promise<unknown>;
    runs: (params?: string) => Promise<{
        items: RunSummary[];
    }>;
    createRun: (body: Record<string, unknown>) => Promise<unknown>;
    runDetail: (id: string) => Promise<RunDetail>;
    runIssues: (id: string) => Promise<{
        items: Issue[];
    }>;
    runIterations: (id: string) => Promise<{
        items: Iteration[];
    }>;
    runTests: (id: string) => Promise<{
        items: TestResult[];
    }>;
    cancelRun: (id: string) => Promise<unknown>;
    retryRun: (id: string) => Promise<unknown>;
    issue: (id: string) => Promise<{
        issue: Issue;
    }>;
    environments: () => Promise<{
        items: EnvHealth[];
    }>;
    deployments: () => Promise<{
        items: Deployment[];
    }>;
    approveDeployment: (id: string) => Promise<unknown>;
    rollbackDeployment: (id: string, toDeploymentId?: string) => Promise<unknown>;
    metrics: () => Promise<Metrics>;
    policies: () => Promise<{
        policy: Record<string, unknown>;
        environments: Record<string, unknown>;
    }>;
    updatePolicies: (body: Record<string, unknown>) => Promise<unknown>;
    audit: () => Promise<{
        items: unknown[];
    }>;
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
    gates: Array<{
        gate: string;
        passed: boolean;
        detail: string;
        required: boolean;
    }>;
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
    evidence: Array<{
        kind: string;
        description: string;
    }>;
    history: Array<{
        at: string;
        to: string;
        actor: string;
        reason: string;
    }>;
}
export interface Iteration {
    iteration: number;
    at: string;
    events: Array<{
        at: string;
        type: string;
        payload: Record<string, unknown>;
    }>;
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
    approvals: Array<{
        actor: string;
        at: string;
    }>;
    healthChecks: Array<{
        name: string;
        ok: boolean;
        detail: string;
    }>;
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
export declare function subscribeRunEvents(runId: string, onEvent: (e: {
    type: string;
    payload: unknown;
}) => void): () => void;
//# sourceMappingURL=api.d.ts.map