import { randomUUID } from "node:crypto";
import type { RunEvent, RunRecord, IssueRecord, TestResult } from "@ads/shared-types";
import type { AuditRow, ProjectRow, Store } from "./types";

function paginate<T>(items: T[], page: number, perPage: number) {
  const start = (page - 1) * perPage;
  return { items: items.slice(start, start + perPage), page, perPage, total: items.length };
}

/** In-memory store used for tests and DB-less local demo mode. */
export function createMemoryStore(): Store {
  const projects = new Map<string, ProjectRow>();
  const runs = new Map<string, { run: RunRecord; issues: IssueRecord[] }>();
  const results: TestResult[] = [];
  const artifacts = new Map<string, import("@ads/shared-types").ArtifactRecord>();
  const releases = new Map<string, import("@ads/shared-types").ReleaseRecord>();
  const deployments = new Map<string, import("@ads/shared-types").DeploymentRecord>();
  const events: RunEvent[] = [];
  const claimedWebhooks = new Set<string>();
  const audit: AuditRow[] = [];
  const settings = new Map<string, unknown>();
  let eventSeq = 0;

  return {
    projects: {
      async create(p) {
        const row: ProjectRow = { ...p, createdAt: p.createdAt ?? new Date().toISOString() };
        projects.set(row.id, row);
        return row;
      },
      async list() {
        return [...projects.values()];
      },
      async get(id) {
        return projects.get(id);
      },
      async getByGitlabId(gitlabProjectId) {
        return [...projects.values()].find((p) => p.gitlabProjectId === gitlabProjectId);
      },
    },
    runs: {
      async create(run, issues) {
        runs.set(run.id, { run: { ...run }, issues: structuredClone(issues) });
        return run;
      },
      async get(id) {
        const row = runs.get(id);
        return row ? { run: { ...row.run }, issues: structuredClone(row.issues) } : undefined;
      },
      async list(filter, page, perPage) {
        let all = [...runs.values()].map((r) => r.run);
        if (filter.projectId) all = all.filter((r) => r.projectId === filter.projectId);
        if (filter.state) all = all.filter((r) => r.state === filter.state);
        all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return paginate(all, page, perPage);
      },
      async update(run, issues) {
        runs.set(run.id, { run: { ...run }, issues: structuredClone(issues) });
      },
    },
    testResults: {
      async createMany(runId, rs) {
        for (const r of rs) results.push({ ...r, runId } as TestResult & { runId: string });
      },
      async listByRun(runId) {
        return results.filter((r) => (r as TestResult & { runId?: string }).runId === runId);
      },
    },
    artifacts: {
      async create(a) {
        artifacts.set(a.id, a);
        return a;
      },
      async get(id) {
        return artifacts.get(id);
      },
      async listByRun(runId) {
        return [...artifacts.values()].filter((a) => a.runId === runId);
      },
    },
    releases: {
      async create(r) {
        releases.set(r.id, r);
        return r;
      },
      async get(id) {
        return releases.get(id);
      },
      async list() {
        return [...releases.values()];
      },
      async update(r) {
        releases.set(r.id, r);
      },
    },
    deployments: {
      async create(d) {
        deployments.set(d.id, d);
        return d;
      },
      async get(id) {
        return deployments.get(id);
      },
      async list(filter, page, perPage) {
        let all = [...deployments.values()];
        if (filter.environment) all = all.filter((d) => d.environment === filter.environment);
        all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return paginate(all, page, perPage);
      },
      async update(d) {
        deployments.set(d.id, d);
      },
    },
    events: {
      async append(runId, type, payload) {
        const evt: RunEvent = { id: ++eventSeq, runId, type: type as RunEvent["type"], at: new Date().toISOString(), payload };
        events.push(evt);
        return evt;
      },
      async listByRun(runId, sinceId = 0) {
        return events.filter((e) => e.runId === runId && e.id > sinceId);
      },
    },
    webhookEvents: {
      async claim(key) {
        if (claimedWebhooks.has(key)) return false;
        claimedWebhooks.add(key);
        return true;
      },
    },
    audit: {
      async add(row) {
        const entry: AuditRow = { id: randomUUID(), at: new Date().toISOString(), ...row };
        audit.push(entry);
        return entry;
      },
      async list() {
        return [...audit].reverse();
      },
    },
    settings: {
      async get<T>(key: string, fallback: T) {
        return (settings.has(key) ? (settings.get(key) as T) : fallback);
      },
      async set<T>(key: string, value: T) {
        settings.set(key, value);
      },
    },
    async health() {
      return { ok: true, detail: "memory" };
    },
  };
}
