import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  approveDeploymentSchema,
  connectProjectSchema,
  createDeploymentSchema,
  createRunSchema,
  rollbackSchema,
  paginationSchema,
  DEFAULT_BUDGET,
  type DeploymentRecord,
  type IssueRecord,
  type QualityGateResult,
  type RunRecord,
} from "@ads/shared-types";
import { TokenVault, createGitLabService, verifyFlowCallback, verifyGitLabWebhook } from "@ads/gitlab-integration";
import { evaluateQualityGates, checkEnvironmentEligibility, DEFAULT_POLICY } from "@ads/policy-engine";
import { createArtifact, createRelease, approveRelease, verifyArtifactIdentity } from "@ads/artifact-service";
import type { Orchestrator } from "@ads/orchestrator";
import { requireRole, type Role } from "./auth";
import type { Config } from "./config";
import type { RunEventBus } from "./events";
import type { Store } from "./store/types";

export interface AppDeps {
  config: Config;
  store: Store;
  bus: RunEventBus;
  orchestrator: Orchestrator;
  vault: TokenVault;
  enqueueRun?: (runId: string) => Promise<void>;
}

function badRequest(res: Response, details: unknown): void {
  res.status(400).json({ error: { code: "validation_error", message: "Invalid request", details } });
}

function notFound(res: Response, what: string): void {
  res.status(404).json({ error: { code: "not_found", message: `${what} not found` } });
}

/** Kick off execution (in-process driver) or hand to the queue driver. */
function startRun(deps: AppDeps, runId: string): void {
  if (deps.enqueueRun) {
    void deps.enqueueRun(runId).catch((err) => console.error("[api] enqueue failed:", err));
  } else {
    void deps.orchestrator.run(runId).catch((err) => console.error("[api] run failed:", err));
  }
}

export function buildRouter(deps: AppDeps): Router {
  const router = Router();
  const { store, config } = deps;

  /* ------------------------- Projects ------------------------- */

  router.post("/projects/connect", async (req: Request, res: Response) => {
    const parsed = connectProjectSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const input = parsed.data;
    const { api } = createGitLabService({
      baseUrl: input.gitlabBaseUrl,
      token: input.token,
      duoFlowsEnabled: config.duoFlowsEnabled,
    });
    try {
      const project = await api.findProject(input.gitlabProjectId ?? input.pathWithNamespace!);
      const row = await store.projects.create({
        id: cryptoRandom(),
        name: input.name ?? project.name,
        gitlabBaseUrl: input.gitlabBaseUrl,
        gitlabProjectId: project.id,
        pathWithNamespace: project.path_with_namespace,
        defaultBranch: project.default_branch ?? "main",
        tokenEncrypted: deps.vault.encrypt(input.token), // encrypted at rest
        webUrl: project.web_url,
      });
      await store.audit.add({
        actor: req.auth?.key ?? "unknown",
        action: "project.connect",
        detail: `Connected ${project.path_with_namespace} (${project.id})`,
      });
      res.status(201).json({ project: { ...row, tokenEncrypted: undefined } });
    } catch (err) {
      res.status(502).json({
        error: {
          code: "gitlab_unreachable",
          message: err instanceof Error ? err.message : "Failed to validate project access",
        },
      });
    }
  });

  router.get("/projects", async (_req, res) => {
    const projects = await store.projects.list();
    res.json({
      items: projects.map(({ tokenEncrypted: _t, ...p }) => p),
      page: 1,
      perPage: projects.length,
      total: projects.length,
    });
  });

  router.get("/projects/:id", async (req, res) => {
    const project = await store.projects.get(req.params.id);
    if (!project) return notFound(res, "Project");
    const include = String(req.query.include ?? "").split(",").filter(Boolean);
    const extra: Record<string, unknown> = {};
    if (include.length > 0) {
      const { api } = createGitLabService({
        baseUrl: project.gitlabBaseUrl,
        token: deps.vault.decrypt(project.tokenEncrypted),
        duoFlowsEnabled: config.duoFlowsEnabled,
      });
      try {
        if (include.includes("branches")) extra.branches = await api.listBranches(project.gitlabProjectId);
        if (include.includes("commits")) extra.commits = (await api.listCommits(project.gitlabProjectId)).slice(0, 30);
        if (include.includes("merge_requests")) extra.mergeRequests = await api.listMergeRequests(project.gitlabProjectId, "opened");
        if (include.includes("pipelines")) extra.pipelines = (await api.listPipelines(project.gitlabProjectId)).slice(0, 20);
      } catch (err) {
        extra.gitlabError = err instanceof Error ? err.message : "GitLab request failed";
      }
    }
    const { tokenEncrypted: _t, ...projectDto } = project;
    res.json({ project: projectDto, ...extra });
  });
  router.get("/projects/:id/commits", async (req, res) => {
    const parsed = paginationSchema.extend({ ref: z.string().trim().min(1).optional() }).safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const project = await store.projects.get(req.params.id);
    if (!project) return notFound(res, "Project");
    const { api } = createGitLabService({
      baseUrl: project.gitlabBaseUrl,
      token: deps.vault.decrypt(project.tokenEncrypted),
      duoFlowsEnabled: config.duoFlowsEnabled,
    });
    try {
      const { page, perPage, ref } = parsed.data;
      res.json(await api.listCommitsPage(project.gitlabProjectId, ref ?? project.defaultBranch, page, perPage));
    } catch {
      res.status(502).json({ error: { code: "gitlab_unreachable", message: "Unable to load commits from GitLab. Check project access and the branch or tag." } });
    }
  });

  /* --------------------------- Runs --------------------------- */

  router.post("/runs", requireRole("engineer"), async (req: Request, res: Response) => {
    const parsed = createRunSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const input = parsed.data;
    const project = await store.projects.get(input.projectId);
    if (!project) return notFound(res, "Project");

    let commitSha = input.commitSha ?? "";
    if (!commitSha) {
      const { api } = createGitLabService({
        baseUrl: project.gitlabBaseUrl,
        token: deps.vault.decrypt(project.tokenEncrypted),
        duoFlowsEnabled: config.duoFlowsEnabled,
      });
      try {
        const commits = await api.listCommits(project.gitlabProjectId, input.ref);
        commitSha = commits[0]?.id ?? "";
      } catch (err) {
        return res.status(502).json({
          error: { code: "gitlab_unreachable", message: err instanceof Error ? err.message : "commit lookup failed" },
        });
      }
    }
    if (!commitSha) {
      return res.status(422).json({ error: { code: "no_commit", message: `No commits for ref ${input.ref}` } });
    }

    const run = deps.orchestrator.createRun({
      projectId: project.id,
      gitlabProjectId: project.gitlabProjectId,
      ref: input.ref,
      commitSha,
      budget: input.budget,
    });
    await store.runs.create(run, []);
    await store.audit.add({
      actor: req.auth?.key ?? "unknown",
      action: "run.create",
      detail: `Run ${run.id} on ${project.pathWithNamespace}@${commitSha.slice(0, 8)}`,
    });
    startRun(deps, run.id);
    res.status(202).json({ run });
  });

  router.get("/runs", async (req, res) => {
    const page = paginationSchema.parse(req.query);
    const filter: { projectId?: string; state?: string } = {};
    if (req.query.projectId) filter.projectId = String(req.query.projectId);
    if (req.query.state) filter.state = String(req.query.state);
    res.json(await store.runs.list(filter, page.page, page.perPage));
  });

  router.get("/runs/:id", async (req, res) => {
    const row = await store.runs.get(req.params.id);
    if (!row) return notFound(res, "Run");
    res.json({ run: row.run, issues: row.issues, metrics: computeRunMetrics(row.run, row.issues) });
  });

  router.post("/runs/:id/cancel", async (req, res) => {
    const row = await store.runs.get(req.params.id);
    if (!row) return notFound(res, "Run");
    if (["READY_FOR_BUILD", "CANCELLED", "FAILED"].includes(row.run.state)) {
      return res.status(409).json({ error: { code: "already_terminal", message: `Run is ${row.run.state}` } });
    }
    const updated = await deps.orchestrator.cancel(row.run.id);
    await store.audit.add({ actor: req.auth?.key ?? "unknown", action: "run.cancel", detail: `Run ${row.run.id}` });
    res.json({ run: updated });
  });

  router.post("/runs/:id/retry", async (req, res) => {
    const row = await store.runs.get(req.params.id);
    if (!row) return notFound(res, "Run");
    const retry = deps.orchestrator.createRun({
      projectId: row.run.projectId,
      gitlabProjectId: row.run.gitlabProjectId,
      ref: row.run.ref,
      commitSha: row.run.commitSha,
      budget: row.run.budget,
      parentRunId: row.run.id,
    });
    await store.runs.create(retry, []);
    await store.audit.add({ actor: req.auth?.key ?? "unknown", action: "run.retry", detail: `${row.run.id} -> ${retry.id}` });
    startRun(deps, retry.id);
    res.status(202).json({ run: retry });
  });

  router.get("/runs/:id/events", async (req, res) => {
    const row = await store.runs.get(req.params.id);
    if (!row) return notFound(res, "Run");
    const sinceId = Number(req.query.since ?? 0);
    await deps.bus.subscribe(row.run.id, res, Number.isFinite(sinceId) ? sinceId : 0);
  });

  router.get("/runs/:id/issues", async (req, res) => {
    const row = await store.runs.get(req.params.id);
    if (!row) return notFound(res, "Run");
    res.json({ items: row.issues, page: 1, perPage: row.issues.length, total: row.issues.length });
  });
  router.get("/issues/:id", async (req, res) => {
    const runs = await store.runs.list({}, 1, 100);
    for (const r of runs.items) {
      const row = await store.runs.get(r.id);
      const issue = row?.issues.find((i) => i.id === req.params.id);
      if (issue && row) {
        res.json({ issue, runId: row.run.id, projectId: row.run.projectId, commitSha: row.run.commitSha });
        return;
      }
    }
    notFound(res, "Issue");
  });

  router.get("/runs/:id/iterations", async (req, res) => {
    const row = await store.runs.get(req.params.id);
    if (!row) return notFound(res, "Run");
    const events = await store.events.listByRun(row.run.id);
    const byIteration = new Map<number, Array<{ at: string; type: string; payload: Record<string, unknown> }>>();
    for (const evt of events) {
      const iter = Number((evt.payload as { iteration?: number }).iteration ?? row.run.iteration);
      const list = byIteration.get(iter) ?? [];
      list.push({ at: evt.at, type: evt.type, payload: evt.payload });
      byIteration.set(iter, list);
    }
    const iterations = [...byIteration.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([iteration, evts]) => ({
        iteration,
        events: evts,
        reason:
          evts.find((e) => e.type === "state_changed" && e.payload.to === "NEXT_ITERATION")?.payload.reason ??
          undefined,
      }));
    res.json({ items: iterations, total: iterations.length });
  });

  router.get("/runs/:id/test-results", async (req, res) => {
    const results = await store.testResults.listByRun(req.params.id);
    res.json({ items: results, page: 1, perPage: results.length, total: results.length });
  });

  /* -------------------- Release / artifact -------------------- */

  router.post("/runs/:id/release", requireRole("engineer"), async (req, res) => {
    const row = await store.runs.get(req.params.id);
    if (!row) return notFound(res, "Run");
    if (row.run.state !== "READY_FOR_BUILD") {
      return res.status(409).json({
        error: { code: "not_ready", message: `Run state is ${row.run.state}; only READY_FOR_BUILD runs can be released` },
      });
    }
    const gates: QualityGateResult[] = evaluateQualityGates({
      issues: row.issues,
      testResults: await store.testResults.listByRun(row.run.id),
      securityScanPassed: row.issues.every(
        (i) => i.category !== "security" || i.state === "verified_fixed" || i.state === "false_positive",
      ),
      policy: await store.settings.get("policy", DEFAULT_POLICY),
    });
    const passed = gates.every((g) => !g.required || g.passed);
    const artifact = createArtifact({
      runId: row.run.id,
      sourceCommitSha: row.run.commitSha,
      kind: "server_package",
      metadata: { ref: row.run.ref, gates: String(gates.filter((g) => g.passed).length) },
      content: JSON.stringify({ sha: row.run.commitSha, gates, at: new Date().toISOString() }),
    });
    await store.artifacts.create(artifact);
    const release = createRelease({
      artifact,
      testEvidence: (await store.testResults.listByRun(row.run.id)).map((t) => t.timestamp),
      securityScanStatus: passed ? "pass" : "fail",
      qualityGateDecision: passed ? "pass" : "fail",
    });
    await store.releases.create(release);
    await store.audit.add({ actor: req.auth?.key ?? "unknown", action: "release.create", detail: `Release ${release.id} (${artifact.digest.slice(0, 20)}…)` });
    res.status(201).json({ release, artifact });
  });

  /* ------------------------ Environments ---------------------- */

  router.get("/environments", async (_req, res) => {
    const deployments = await store.deployments.list({}, 1, 100);
    const healthUrls = await store.settings.get<Record<string, string>>("envHealthUrls", {});
    const envs = ["DEVELOPMENT", "STAGING", "PRODUCTION"].map((environment) => {
      const forEnv = deployments.items.filter((d) => d.environment === environment);
      const current = forEnv.find((d) => d.status === "deployed") ?? forEnv[0];
      return {
        name: environment,
        currentDeployment: current,
        healthUrl: healthUrls[environment],
        healthy: current ? current.healthChecks.every((h) => h.ok) : undefined,
        deployedCount: forEnv.filter((d) => d.status === "deployed").length,
        simulatedLocal: true,
      };
    });
    res.json({ items: envs });
  });
  /* ------------------------ Deployments ----------------------- */

  router.get("/deployments", async (req, res) => {
    const page = paginationSchema.parse(req.query);
    const filter: { environment?: string } = {};
    if (req.query.environment) filter.environment = String(req.query.environment);
    res.json(await store.deployments.list(filter, page.page, page.perPage));
  });

  router.post("/deployments", requireRole("engineer"), async (req, res) => {
    const parsed = createDeploymentSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const { releaseId, environment } = parsed.data;
    const release = await store.releases.get(releaseId);
    if (!release) return notFound(res, "Release");
    const artifact = await store.artifacts.get(release.artifactId);
    if (!artifact) return notFound(res, "Artifact");
    const identity = verifyArtifactIdentity(release, artifact);
    if (!identity.ok) {
      return res.status(409).json({ error: { code: "artifact_mismatch", message: identity.reasons.join("; ") } });
    }

    const prior = await store.deployments.list({}, 1, 100);
    const priorStaging = prior.items.find((d) => d.environment === "STAGING" && d.status === "deployed");
    const policy = await store.settings.get("policy", DEFAULT_POLICY);
    const approvals = release.approvals.filter((a) => a.environment === environment).length;
    const eligibility = checkEnvironmentEligibility(release, environment, priorStaging?.artifactDigest, approvals, policy);
    if (!eligibility.eligible) {
      return res.status(409).json({
        error: { code: "ineligible_environment", message: eligibility.reasons.join("; "), details: eligibility.reasons },
      });
    }

    const needsApproval = policy.requiredApprovals[environment] > approvals;
    const deployment: DeploymentRecord = {
      id: cryptoRandom(),
      releaseId: release.id,
      environment,
      status: needsApproval ? "pending_approval" : "approved",
      artifactDigest: release.artifactDigest,
      sourceCommitSha: release.sourceCommitSha,
      healthChecks: [],
      rollbackAvailable: false,
      auditTrail: [
        {
          at: new Date().toISOString(),
          actor: req.auth?.key ?? "unknown",
          action: "deploy.request",
          detail: `Deploy release ${release.id} to ${environment}`,
        },
      ],
      createdAt: new Date().toISOString(),
    };
    await store.deployments.create(deployment);
    await store.audit.add({
      actor: req.auth?.key ?? "unknown",
      action: "deployment.create",
      detail: `${environment} <- ${release.artifactDigest.slice(0, 20)}…`,
    });
    if (!needsApproval) await executeDeployment(deps, deployment, req.auth?.key ?? "system");
    res.status(201).json({ deployment });
  });

  router.post("/deployments/:id/approve", requireRole("admin"), async (req, res) => {
    const parsed = approveDeploymentSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const deployment = await store.deployments.get(req.params.id);
    if (!deployment) return notFound(res, "Deployment");
    if (deployment.status !== "pending_approval") {
      return res.status(409).json({ error: { code: "invalid_state", message: `Deployment is ${deployment.status}` } });
    }
    const { actor, decision } = parsed.data;
    if (decision === "reject") {
      deployment.status = "rejected";
      deployment.auditTrail.push({ at: new Date().toISOString(), actor, action: "deploy.reject", detail: "Rejected by approver" });
      await store.deployments.update(deployment);
      return res.json({ deployment });
    }
    const release = await store.releases.get(deployment.releaseId);
    if (!release) return notFound(res, "Release");
    await store.releases.update(approveRelease(release, actor, deployment.environment));
    deployment.status = "approved";
    deployment.auditTrail.push({ at: new Date().toISOString(), actor, action: "deploy.approve", detail: `Approved for ${deployment.environment}` });
    await store.deployments.update(deployment);
    await store.audit.add({ actor, action: "deployment.approve", detail: `${deployment.id} -> ${deployment.environment}` });
    await executeDeployment(deps, deployment, actor);
    res.json({ deployment });
  });
  router.post("/deployments/:id/rollback", requireRole("admin"), async (req, res) => {
    const parsed = rollbackSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const deployment = await store.deployments.get(req.params.id);
    if (!deployment) return notFound(res, "Deployment");
    if (deployment.status !== "deployed" || !deployment.rollbackAvailable) {
      return res.status(409).json({
        error: { code: "rollback_unavailable", message: "Rollback requires a deployed artifact with a known-good predecessor" },
      });
    }
    const all = await store.deployments.list({}, 1, 100);
    const predecessor = all.items.find(
      (d) =>
        d.environment === deployment.environment &&
        d.status === "deployed" &&
        d.id !== deployment.id &&
        d.artifactDigest !== deployment.artifactDigest,
    );
    if (!predecessor) {
      return res.status(409).json({ error: { code: "no_known_good", message: "No known-good predecessor in this environment" } });
    }
    const { actor, reason } = parsed.data;
    deployment.status = "rolled_back";
    deployment.auditTrail.push({ at: new Date().toISOString(), actor, action: "deploy.rollback", detail: reason });
    await store.deployments.update(deployment);

    const rollback: DeploymentRecord = {
      id: cryptoRandom(),
      releaseId: predecessor.releaseId,
      environment: deployment.environment,
      status: "in_progress",
      artifactDigest: predecessor.artifactDigest,
      sourceCommitSha: predecessor.sourceCommitSha,
      healthChecks: [],
      rollbackAvailable: false,
      rollbackOfDeploymentId: deployment.id,
      auditTrail: [
        {
          at: new Date().toISOString(),
          actor,
          action: "deploy.rollback.execute",
          detail: `Restoring ${predecessor.artifactDigest.slice(0, 20)}… (${reason})`,
        },
      ],
      createdAt: new Date().toISOString(),
    };
    await store.deployments.create(rollback);
    await store.audit.add({ actor, action: "deployment.rollback", detail: `${deployment.id} -> ${rollback.id}` });
    await executeDeployment(deps, rollback, actor);
    res.json({ rolledBack: deployment, rollbackDeployment: rollback });
  });

  /* -------------------------- Metrics ------------------------- */

  router.get("/metrics", async (_req, res) => {
    const runs = await store.runs.list({}, 1, 100);
    const deployments = await store.deployments.list({}, 1, 100);
    let initial = 0, remaining = 0, verified = 0, reopened = 0, criticals = 0;
    let iterations = 0, successfulRuns = 0, tokens = 0;
    for (const r of runs.items) {
      const row = await store.runs.get(r.id);
      if (!row) continue;
      iterations += row.run.iteration;
      tokens += row.run.tokensUsed;
      if (row.run.state === "READY_FOR_BUILD") successfulRuns++;
      for (const i of row.issues) {
        initial++;
        if (i.state === "verified_fixed") verified++;
        if (i.state === "reopened") reopened++;
        if (i.state === "reopened" || i.state === "open" || i.state === "triaged") remaining++;
        if (i.severity === "critical" && !["verified_fixed", "false_positive", "accepted_risk"].includes(i.state)) criticals++;
      }
    }
    const allResults = (
      await Promise.all(runs.items.map((r) => store.testResults.listByRun(r.id)))
    ).flat();
    const totalTests = allResults.reduce((a, t) => a + (t.total ?? 1), 0);
    const passedTests = allResults.reduce((a, t) => a + (t.passed ? (t.total ?? 1) : (t.total ?? 1) - (t.failed ?? 1)), 0);
    const deployed = deployments.items.filter((d) => d.status === "deployed").length;
    const failedDeployments = deployments.items.filter((d) => d.status === "failed").length;
    res.json({
      connectedProjects: (await store.projects.list()).length,
      activeRuns: runs.items.filter((r) => !["READY_FOR_BUILD", "BLOCKED", "FAILED", "CANCELLED", "NEEDS_HUMAN_REVIEW"].includes(r.state)).length,
      totalFindings: initial,
      verifiedFixes: verified,
      remainingFindings: remaining,
      reopenedIssues: reopened,
      openCriticalIssues: criticals,
      testPassRate: totalTests === 0 ? null : passedTests / totalTests,
      avgIterationsPerRun: runs.items.length === 0 ? null : iterations / runs.items.length,
      successfulRunRate: runs.items.length === 0 ? null : successfulRuns / runs.items.length,
      deploymentSuccessRate: deployed + failedDeployments === 0 ? null : deployed / (deployed + failedDeployments),
      estimatedAiCostUsd: Number((tokens * 0.000003).toFixed(4)),
      tokensUsed: tokens,
      verifiedFixRateDenominator: initial,
      verifiedFixRate: initial === 0 ? null : verified / initial,
    });
  });

  /* -------------------------- Policies ------------------------ */

  router.get("/policies", async (_req, res) => {
    res.json({ policy: await store.settings.get("policy", DEFAULT_POLICY) });
  });

  router.put("/policies", requireRole("admin"), async (req, res) => {
    const parsed = z.record(z.any()).safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.flatten());
    const merged = { ...(await store.settings.get("policy", DEFAULT_POLICY)), ...parsed.data };
    await store.settings.set("policy", merged);
    await store.audit.add({ actor: req.auth?.key ?? "unknown", action: "policy.update", detail: JSON.stringify(merged) });
    res.json({ policy: merged });
  });

  router.get("/audit", async (_req, res) => {
    res.json({ items: await store.audit.list() });
  });

  router.get("/health", async (_req, res) => {
    const db = await store.health().catch((e) => ({ ok: false, detail: e instanceof Error ? e.message : "error" }));
    res.status(db.ok ? 200 : 503).json({ status: db.ok ? "ok" : "degraded", store: db.detail });
  });
  /* -------------------------- Webhooks ------------------------- */

  router.post("/webhooks/gitlab", async (req, res) => {
    const raw = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const headers = req.headers as Record<string, string | undefined>;

    // GitLab Duo flow callbacks (flow.started/completed/failed/progress) share this
    // endpoint — verify signature, dedupe by event_id, ack every delivery.
    const asFlow = verifyFlowCallback(headers, raw, config.GITLAB_WEBHOOK_SECRET);
    if (asFlow.ok) {
      const first = await store.webhookEvents.claim(`flow:${asFlow.dedupeKey}`);
      if (!first) return res.status(200).json({ status: "duplicate_ignored" });
      const ref = String(asFlow.event.client_reference ?? "");
      const runMatch = /^run:([^:]+):/.exec(ref);
      if (runMatch) {
        await deps.bus.publish(runMatch[1], "log", {
          message: `Duo flow event ${asFlow.event.event} (workflow ${asFlow.event.workflow_id ?? "?"})`,
        });
      }
      await store.audit.add({ actor: "gitlab-duo-flow", action: `flow.${asFlow.event.event}`, detail: ref || "-" });
      return res.status(200).json({ status: "ok" });
    }

    const verified = verifyGitLabWebhook(headers, raw, config.GITLAB_WEBHOOK_SECRET);
    if (!verified.ok) {
      return res.status(401).json({ error: { code: "invalid_webhook", message: verified.reason } });
    }
    const first = await store.webhookEvents.claim(verified.idempotencyKey);
    if (!first) return res.status(200).json({ status: "duplicate_ignored" });

    const evt = verified.event;
    const kind = evt.object_kind ?? evt.event_type ?? "unknown";
    const project = await store.projects.getByGitlabId(evt.project?.id ?? -1);
    if (!project) return res.status(200).json({ status: "ignored_unconnected_project" });

    const isPush = kind === "push" && !!evt.after && !evt.after.startsWith("0000000");
    const mrEvent =
      kind === "merge_request" && ["open", "update", "reopen"].includes(evt.merge_request?.action ?? "");

    if (isPush) {
      await triggerWebhookRun(deps, project.id, project.defaultBranch, evt.checkout_sha ?? evt.after!);
      return res.status(200).json({ status: "run_triggered" });
    }
    if (mrEvent && evt.merge_request) {
      const sha = evt.after ?? evt.checkout_sha ?? "";
      if (sha) await triggerWebhookRun(deps, project.id, project.defaultBranch, sha, evt.merge_request.iid);
      return res.status(200).json({ status: "run_triggered" });
    }
    return res.status(200).json({ status: "ignored" });
  });

  return router;
}

async function triggerWebhookRun(
  deps: AppDeps,
  projectId: string,
  ref: string,
  commitSha: string,
  mrIid?: number,
): Promise<void> {
  const project = await deps.store.projects.get(projectId);
  if (!project) return;
  const run = deps.orchestrator.createRun({
    projectId,
    gitlabProjectId: project.gitlabProjectId,
    ref,
    commitSha,
  });
  await deps.store.runs.create(run, []);
  await deps.store.audit.add({
    actor: "webhook",
    action: "run.create",
    detail: `GitLab webhook${mrIid ? ` (MR !${mrIid})` : ""} @ ${commitSha.slice(0, 8)}`,
  });
  startRun(deps, run.id);
}
function computeRunMetrics(run: RunRecord, issues: IssueRecord[]) {
  const resolved = ["verified_fixed", "accepted_risk", "false_positive"];
  const open = issues.filter((i) => !resolved.includes(i.state));
  const verified = issues.filter((i) => i.state === "verified_fixed");
  const excluded = issues.filter((i) => i.state === "accepted_risk" || i.state === "false_positive");
  const denominator = issues.length - excluded.length;
  return {
    iterations: run.iteration,
    initialFindings: issues.length,
    remainingFindings: open.length,
    verifiedFixes: verified.length,
    reopenedIssues: issues.filter((i) => i.state === "reopened").length,
    openCritical: open.filter((i) => i.severity === "critical").length,
    verifiedFixRate: denominator <= 0 ? null : verified.length / denominator,
    verifiedFixRateDenominator: denominator,
    verifiedFixRateExclusions: excluded.length,
    stopReason: run.stopReason,
    tokensUsed: run.tokensUsed,
    durationMs:
      (run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) -
      Date.parse(run.startedAt ?? run.createdAt),
  };
}

/** Health-checked deployment execution (local simulation of environment promotion). */
async function executeDeployment(
  deps: AppDeps,
  deployment: DeploymentRecord,
  actor: string,
): Promise<void> {
  const { store } = deps;
  deployment.status = "in_progress";
  deployment.startedAt = new Date().toISOString();
  deployment.auditTrail.push({
    at: deployment.startedAt,
    actor,
    action: "deploy.start",
    detail: `to ${deployment.environment}`,
  });
  await store.deployments.update(deployment);

  const healthUrls = await store.settings.get<Record<string, string>>("envHealthUrls", {});
  const url = healthUrls[deployment.environment];
  const checks: DeploymentRecord["healthChecks"] = [];
  const at = new Date().toISOString();
  if (url) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const response = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      checks.push({ name: "http-health", ok: response.ok, detail: `HTTP ${response.status} from ${url}`, at });
    } catch (err) {
      checks.push({
        name: "http-health",
        ok: false,
        detail: err instanceof Error ? err.message : "unreachable",
        at,
      });
    }
  } else {
    checks.push({
      name: "simulated-health",
      ok: true,
      detail: "No health URL configured — local simulation, not a real staging/production deployment",
      at,
    });
  }

  const healthy = checks.every((c) => c.ok);
  deployment.healthChecks = checks;
  deployment.finishedAt = new Date().toISOString();
  deployment.status = healthy ? "deployed" : "failed";
  const all = await store.deployments.list({}, 1, 100);
  deployment.rollbackAvailable =
    healthy &&
    all.items.some(
      (d) =>
        d.environment === deployment.environment &&
        d.status === "deployed" &&
        d.artifactDigest !== deployment.artifactDigest,
    );
  deployment.auditTrail.push({
    at: deployment.finishedAt,
    actor,
    action: healthy ? "deploy.success" : "deploy.failure",
    detail: checks.map((c) => `${c.name}: ${c.ok ? "ok" : "FAIL"} — ${c.detail}`).join("; "),
  });
  await store.deployments.update(deployment);
  await store.audit.add({
    actor,
    action: "deployment.execute",
    detail: `${deployment.environment}: ${deployment.status} (${deployment.artifactDigest.slice(0, 20)}…)`,
  });
}

function cryptoRandom(): string {
  return globalThis.crypto.randomUUID();
}
