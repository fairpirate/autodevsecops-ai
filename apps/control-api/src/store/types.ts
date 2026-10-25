import type {
  ArtifactRecord,
  DeploymentRecord,
  IssueRecord,
  Paginated,
  ReleaseRecord,
  RunEvent,
  RunRecord,
  TestResult,
} from "@ads/shared-types";

export interface ProjectRow {
  id: string;
  name: string;
  gitlabBaseUrl: string;
  gitlabProjectId: number;
  pathWithNamespace: string;
  defaultBranch: string;
  tokenEncrypted: string;
  webUrl?: string;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

/**
 * Control-plane persistence. Implementations: MemoryStore (dev/test),
 * PrismaStore (PostgreSQL). Runs embed their issues as a JSON document so a
 * run + ledger snapshot round-trips atomically.
 */
export interface Store {
  projects: {
    create(p: Omit<ProjectRow, "createdAt"> & { createdAt?: string }): Promise<ProjectRow>;
    list(): Promise<ProjectRow[]>;
    get(id: string): Promise<ProjectRow | undefined>;
    getByGitlabId(gitlabProjectId: number): Promise<ProjectRow | undefined>;
  };
  runs: {
    create(run: RunRecord, issues: IssueRecord[]): Promise<RunRecord>;
    get(id: string): Promise<{ run: RunRecord; issues: IssueRecord[] } | undefined>;
    list(filter: { projectId?: string; state?: string }, page: number, perPage: number): Promise<Paginated<RunRecord>>;
    update(run: RunRecord, issues: IssueRecord[]): Promise<void>;
  };
  testResults: {
    createMany(runId: string, results: TestResult[]): Promise<void>;
    listByRun(runId: string): Promise<TestResult[]>;
  };
  artifacts: {
    create(a: ArtifactRecord): Promise<ArtifactRecord>;
    get(id: string): Promise<ArtifactRecord | undefined>;
    listByRun(runId: string): Promise<ArtifactRecord[]>;
  };
  releases: {
    create(r: ReleaseRecord): Promise<ReleaseRecord>;
    get(id: string): Promise<ReleaseRecord | undefined>;
    list(): Promise<ReleaseRecord[]>;
    update(r: ReleaseRecord): Promise<void>;
  };
  deployments: {
    create(d: DeploymentRecord): Promise<DeploymentRecord>;
    get(id: string): Promise<DeploymentRecord | undefined>;
    list(filter: { environment?: string }, page: number, perPage: number): Promise<Paginated<DeploymentRecord>>;
    update(d: DeploymentRecord): Promise<void>;
  };
  events: {
    append(runId: string, type: string, payload: Record<string, unknown>): Promise<RunEvent>;
    listByRun(runId: string, sinceId?: number): Promise<RunEvent[]>;
  };
  webhookEvents: {
    /** Returns true when the key is new (first delivery), false when duplicate. */
    claim(key: string): Promise<boolean>;
  };
  audit: {
    add(row: Omit<AuditRow, "id" | "at">): Promise<AuditRow>;
    list(): Promise<AuditRow[]>;
  };
  settings: {
    get<T>(key: string, fallback: T): Promise<T>;
    set<T>(key: string, value: T): Promise<void>;
  };
  health(): Promise<{ ok: boolean; detail: string }>;
}
