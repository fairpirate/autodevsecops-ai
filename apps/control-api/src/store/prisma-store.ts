import type { RunEvent, RunRecord, IssueRecord, TestResult } from "@ads/shared-types";
import type { AuditRow, ProjectRow, Store } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type PrismaLike = Record<string, any>;

function paginate<T>(items: T[], page: number, perPage: number) {
  const start = (page - 1) * perPage;
  return { items: items.slice(start, start + perPage), page, perPage, total: items.length };
}

/** PostgreSQL-backed store via Prisma (generated client required). */
export function createPrismaStore(prisma: PrismaLike): Store {
  const toRun = (row: any): RunRecord => ({
    id: row.id,
    projectId: row.projectId,
    gitlabProjectId: row.gitlabProjectId,
    ref: row.ref,
    commitSha: row.commitSha,
    state: row.state,
    iteration: row.iteration,
    budget: row.budget,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    stopReason: row.stopReason ?? undefined,
    parentRunId: row.parentRunId ?? undefined,
    failureFingerprints: row.failureFingerprints ?? {},
    noProgressIterations: row.noProgressIterations ?? 0,
    tokensUsed: row.tokensUsed ?? 0,
    costEstimateUsd: row.costEstimateUsd ?? 0,
  });

  return {
    projects: {
      async create(p) {
        const row = await prisma.project.create({ data: { ...p, createdAt: p.createdAt ? new Date(p.createdAt) : undefined } });
        return { ...p, createdAt: row.createdAt.toISOString() } as ProjectRow;
      },
      async list() {
        const rows = await prisma.project.findMany({ orderBy: { createdAt: "desc" } });
        return rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          gitlabBaseUrl: r.gitlabBaseUrl,
          gitlabProjectId: r.gitlabProjectId,
          pathWithNamespace: r.pathWithNamespace,
          defaultBranch: r.defaultBranch,
          tokenEncrypted: r.tokenEncrypted,
          webUrl: r.webUrl ?? undefined,
          createdAt: r.createdAt.toISOString(),
        }));
      },
      async get(id) {
        const r = await prisma.project.findUnique({ where: { id } });
        if (!r) return undefined;
        return {
          id: r.id,
          name: r.name,
          gitlabBaseUrl: r.gitlabBaseUrl,
          gitlabProjectId: r.gitlabProjectId,
          pathWithNamespace: r.pathWithNamespace,
          defaultBranch: r.defaultBranch,
          tokenEncrypted: r.tokenEncrypted,
          webUrl: r.webUrl ?? undefined,
          createdAt: r.createdAt.toISOString(),
        };
      },
      async getByGitlabId(gitlabProjectId) {
        const r = await prisma.project.findFirst({ where: { gitlabProjectId } });
        if (!r) return undefined;
        return {
          id: r.id,
          name: r.name,
          gitlabBaseUrl: r.gitlabBaseUrl,
          gitlabProjectId: r.gitlabProjectId,
          pathWithNamespace: r.pathWithNamespace,
          defaultBranch: r.defaultBranch,
          tokenEncrypted: r.tokenEncrypted,
          webUrl: r.webUrl ?? undefined,
          createdAt: r.createdAt.toISOString(),
        };
      },
    },
    runs: {
      async create(run, issues) {
        await prisma.run.create({
          data: {
            id: run.id,
            projectId: run.projectId,
            gitlabProjectId: run.gitlabProjectId,
            ref: run.ref,
            commitSha: run.commitSha,
            state: run.state,
            iteration: run.iteration,
            budget: run.budget as any,
            issues: issues as any,
            startedAt: run.startedAt ? new Date(run.startedAt) : null,
            finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
            stopReason: run.stopReason ?? null,
            parentRunId: run.parentRunId ?? null,
            failureFingerprints: run.failureFingerprints as any,
            noProgressIterations: run.noProgressIterations,
            tokensUsed: run.tokensUsed,
            costEstimateUsd: run.costEstimateUsd,
            createdAt: new Date(run.createdAt),
            updatedAt: new Date(run.updatedAt),
          },
        });
        return run;
      },
      async get(id) {
        const row = await prisma.run.findUnique({ where: { id } });
        if (!row) return undefined;
        return { run: toRun(row), issues: (row.issues ?? []) as IssueRecord[] };
      },
      async list(filter, page, perPage) {
        const where: any = {};
        if (filter.projectId) where.projectId = filter.projectId;
        if (filter.state) where.state = filter.state;
        const [rows, total] = await Promise.all([
          prisma.run.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage }),
          prisma.run.count({ where }),
        ]);
        return { items: rows.map(toRun), page, perPage, total };
      },
      async update(run, issues) {
        await prisma.run.update({
          where: { id: run.id },
          data: {
            state: run.state,
            iteration: run.iteration,
            issues: issues as any,
            startedAt: run.startedAt ? new Date(run.startedAt) : undefined,
            finishedAt: run.finishedAt ? new Date(run.finishedAt) : undefined,
            stopReason: run.stopReason ?? null,
            failureFingerprints: run.failureFingerprints as any,
            noProgressIterations: run.noProgressIterations,
            tokensUsed: run.tokensUsed,
            costEstimateUsd: run.costEstimateUsd,
            updatedAt: new Date(run.updatedAt),
          },
        });
      },
    },
    testResults: {
      async createMany(runId, rs) {
        await prisma.testResultRecord.createMany({
          data: rs.map((r) => ({
            runId,
            commitSha: r.commitSha,
            artifactId: r.artifactId ?? null,
            environment: r.environment,
            suite: r.suite,
            platform: r.platform,
            passed: r.passed,
            durationMs: r.durationMs,
            failureSummary: r.failureSummary ?? null,
            logLink: r.logLink ?? null,
            total: r.total ?? null,
            failed: r.failed ?? null,
            skipped: r.skipped ?? null,
            timestamp: r.timestamp,
          })),
        });
      },
      async listByRun(runId) {
        const rows = await prisma.testResultRecord.findMany({ where: { runId }, orderBy: { timestamp: "desc" } });
        return rows.map((r: any) => ({
          commitSha: r.commitSha,
          artifactId: r.artifactId ?? undefined,
          environment: r.environment,
          suite: r.suite,
          platform: r.platform,
          passed: r.passed,
          durationMs: r.durationMs,
          failureSummary: r.failureSummary ?? undefined,
          logLink: r.logLink ?? undefined,
          total: r.total ?? undefined,
          failed: r.failed ?? undefined,
          skipped: r.skipped ?? undefined,
          timestamp: r.timestamp,
        }));
      },
    },
    artifacts: {
      async create(a) {
        await prisma.artifact.create({
          data: {
            id: a.id,
            runId: a.runId,
            sourceCommitSha: a.sourceCommitSha,
            pipelineId: a.pipelineId ?? null,
            buildJobId: a.buildJobId ?? null,
            digest: a.digest,
            kind: a.kind,
            metadata: a.metadata as any,
            createdAt: new Date(a.createdAt),
          },
        });
        return a;
      },
      async get(id) {
        const r = await prisma.artifact.findUnique({ where: { id } });
        return r ? { ...r, metadata: r.metadata ?? {}, createdAt: r.createdAt.toISOString() } : undefined;
      },
      async listByRun(runId) {
        const rows = await prisma.artifact.findMany({ where: { runId } });
        return rows.map((r: any) => ({ ...r, metadata: r.metadata ?? {}, createdAt: r.createdAt.toISOString() }));
      },
    },
    releases: {
      async create(r) {
        await prisma.release.create({
          data: {
            id: r.id,
            artifactId: r.artifactId,
            sourceCommitSha: r.sourceCommitSha,
            artifactDigest: r.artifactDigest,
            testEvidence: r.testEvidence as any,
            securityScanStatus: r.securityScanStatus,
            qualityGateDecision: r.qualityGateDecision,
            approvals: r.approvals as any,
            createdAt: new Date(r.createdAt),
          },
        });
        return r;
      },
      async get(id) {
        const r = await prisma.release.findUnique({ where: { id } });
        if (!r) return undefined;
        return {
          id: r.id,
          artifactId: r.artifactId,
          sourceCommitSha: r.sourceCommitSha,
          artifactDigest: r.artifactDigest,
          testEvidence: r.testEvidence ?? [],
          securityScanStatus: r.securityScanStatus as any,
          qualityGateDecision: r.qualityGateDecision,
          approvals: r.approvals ?? [],
          createdAt: r.createdAt.toISOString(),
        };
      },
      async list() {
        const rows = await prisma.release.findMany({ orderBy: { createdAt: "desc" } });
        return rows.map((r: any) => ({
          id: r.id,
          artifactId: r.artifactId,
          sourceCommitSha: r.sourceCommitSha,
          artifactDigest: r.artifactDigest,
          testEvidence: r.testEvidence ?? [],
          securityScanStatus: r.securityScanStatus,
          qualityGateDecision: r.qualityGateDecision,
          approvals: r.approvals ?? [],
          createdAt: r.createdAt.toISOString(),
        }));
      },
      async update(r) {
        await prisma.release.update({
          where: { id: r.id },
          data: { approvals: r.approvals as any, qualityGateDecision: r.qualityGateDecision },
        });
      },
    },
    deployments: {
      async create(d) {
        await prisma.deployment.create({
          data: {
            id: d.id,
            releaseId: d.releaseId,
            environment: d.environment,
            status: d.status,
            artifactDigest: d.artifactDigest,
            sourceCommitSha: d.sourceCommitSha,
            startedAt: d.startedAt ? new Date(d.startedAt) : null,
            finishedAt: d.finishedAt ? new Date(d.finishedAt) : null,
            healthChecks: d.healthChecks as any,
            rollbackAvailable: d.rollbackAvailable,
            rollbackOfDeploymentId: d.rollbackOfDeploymentId ?? null,
            auditTrail: d.auditTrail as any,
            createdAt: new Date(d.createdAt),
          },
        });
        return d;
      },
      async get(id) {
        const r = await prisma.deployment.findUnique({ where: { id } });
        if (!r) return undefined;
        return {
          id: r.id,
          releaseId: r.releaseId,
          environment: r.environment as any,
          status: r.status as any,
          artifactDigest: r.artifactDigest,
          sourceCommitSha: r.sourceCommitSha,
          startedAt: r.startedAt?.toISOString(),
          finishedAt: r.finishedAt?.toISOString(),
          healthChecks: r.healthChecks ?? [],
          rollbackAvailable: r.rollbackAvailable,
          rollbackOfDeploymentId: r.rollbackOfDeploymentId ?? undefined,
          auditTrail: r.auditTrail ?? [],
          createdAt: r.createdAt.toISOString(),
        };
      },
      async list(filter, page, perPage) {
        const where: any = {};
        if (filter.environment) where.environment = filter.environment;
        const [rows, total] = await Promise.all([
          prisma.deployment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage }),
          prisma.deployment.count({ where }),
        ]);
        return {
          items: rows.map((r: any) => ({
            id: r.id,
            releaseId: r.releaseId,
            environment: r.environment,
            status: r.status,
            artifactDigest: r.artifactDigest,
            sourceCommitSha: r.sourceCommitSha,
            startedAt: r.startedAt?.toISOString(),
            finishedAt: r.finishedAt?.toISOString(),
            healthChecks: r.healthChecks ?? [],
            rollbackAvailable: r.rollbackAvailable,
            rollbackOfDeploymentId: r.rollbackOfDeploymentId ?? undefined,
            auditTrail: r.auditTrail ?? [],
            createdAt: r.createdAt.toISOString(),
          })),
          page,
          perPage,
          total,
        };
      },
      async update(d) {
        await prisma.deployment.update({
          where: { id: d.id },
          data: {
            status: d.status,
            startedAt: d.startedAt ? new Date(d.startedAt) : undefined,
            finishedAt: d.finishedAt ? new Date(d.finishedAt) : undefined,
            healthChecks: d.healthChecks as any,
            rollbackAvailable: d.rollbackAvailable,
            auditTrail: d.auditTrail as any,
          },
        });
      },
    },
    events: {
      async append(runId, type, payload) {
        const row = await prisma.eventLog.create({
          data: { runId, type, at: new Date().toISOString(), payload: payload as any },
        });
        return { id: row.id, runId, type: type as RunEvent["type"], at: row.at, payload };
      },
      async listByRun(runId, sinceId = 0) {
        const rows = await prisma.eventLog.findMany({
          where: { runId, id: { gt: sinceId } },
          orderBy: { id: "asc" },
        });
        return rows.map((r: any) => ({ id: r.id, runId: r.runId, type: r.type, at: r.at, payload: r.payload }));
      },
    },
    webhookEvents: {
      async claim(key) {
        try {
          await prisma.webhookEvent.create({ data: { key } });
          return true;
        } catch {
          return false; // primary key conflict => duplicate delivery
        }
      },
    },
    audit: {
      async add(row) {
        const r = await prisma.auditLog.create({ data: row });
        return { id: r.id, at: r.at.toISOString(), actor: r.actor, action: r.action, detail: r.detail };
      },
      async list() {
        const rows = await prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 500 });
        return rows.map((r: any) => ({ id: r.id, at: r.at.toISOString(), actor: r.actor, action: r.action, detail: r.detail }));
      },
    },
    settings: {
      async get<T>(key: string, fallback: T) {
        const row = await prisma.setting.findUnique({ where: { key } });
        return row ? (row.value as T) : fallback;
      },
      async set<T>(key: string, value: T) {
        await prisma.setting.upsert({ where: { key }, create: { key, value: value as any }, update: { value: value as any } });
      },
    },
    async health() {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, detail: "postgres" };
    },
  };
}


