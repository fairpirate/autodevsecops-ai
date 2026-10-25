import type { IssueRecord, RunBudget, RunRecord } from "@ads/shared-types";
import { DEFAULT_BUDGET } from "@ads/shared-types";
import { IssueLedger } from "@ads/issue-ledger";
import { randomUUID } from "node:crypto";
import {
  engineContextOf,
  executeStep,
  type ExecutorDeps,
  type RunSession,
} from "./executor";
import { advance } from "@ads/workflow-engine";
import type { FileMap } from "./ports";

export interface OrchestratorOptions extends ExecutorDeps {
  /** Persist run + issues after each step (Prisma adapter in production). */
  persist?: (run: RunRecord, issues: IssueRecord[]) => Promise<void> | void;
  /** Returns true when a cancel was requested for this run. */
  isCancelled?: (runId: string) => Promise<boolean> | boolean;
}

export interface CreateRunOptions {
  projectId: string;
  gitlabProjectId: number;
  ref: string;
  commitSha: string;
  budget?: Partial<RunBudget>;
  parentRunId?: string;
}

/**
 * Closed-loop review & repair engine host.
 * Owns run sessions, drives `executeStep` until a terminal state or a stop
 * condition, enforces budgets/early-stopping via the workflow engine, and
 * persists state after every transition.
 */
export class Orchestrator {
  private sessions = new Map<string, RunSession>();

  constructor(private readonly opts: OrchestratorOptions) {}

  createRun(o: CreateRunOptions): RunRecord {
    const now = new Date().toISOString();
    const run: RunRecord = {
      id: randomUUID(),
      projectId: o.projectId,
      gitlabProjectId: o.gitlabProjectId,
      ref: o.ref,
      commitSha: o.commitSha,
      state: "INITIALIZED",
      iteration: 1,
      budget: { ...DEFAULT_BUDGET, ...o.budget },
      createdAt: now,
      updatedAt: now,
      parentRunId: o.parentRunId,
      failureFingerprints: {},
      noProgressIterations: 0,
      tokensUsed: 0,
      costEstimateUsd: 0,
    };
    const session: RunSession = {
      run,
      ledger: new IssueLedger(run.id),
      files: {} as FileMap,
      repairs: [],
      targetedTests: [],
      regressionTests: [],
      verifications: [],
      gates: [],
      iterationSnapshot: [],
      changedPaths: [],
      aiTasks: [],
    };
    this.sessions.set(run.id, session);
    return run;
  }

  getSession(runId: string): RunSession | undefined {
    return this.sessions.get(runId);
  }

  /** Rehydrate a session (e.g. after process restart) with persisted records. */
  hydrate(run: RunRecord, issues: IssueRecord[]): RunSession {
    const ledger = new IssueLedger(run.id);
    ledger.hydrate(issues);
    const existing = this.sessions.get(run.id);
    if (existing) {
      existing.run = run;
      existing.ledger = ledger;
      return existing;
    }
    const session: RunSession = {
      run,
      ledger,
      files: {},
      repairs: [],
      targetedTests: [],
      regressionTests: [],
      verifications: [],
      gates: [],
      iterationSnapshot: [],
      changedPaths: [],
      aiTasks: [],
    };
    this.sessions.set(run.id, session);
    return session;
  }

  /** Execute a single step of the workflow. */
  async stepOnce(runId: string): Promise<RunRecord> {
    const session = this.sessions.get(runId);
    if (!session) throw new Error(`Unknown run ${runId}`);
    if (this.opts.isCancelled && (await this.opts.isCancelled(runId))) {
      (session.run as { cancelRequested?: boolean }).cancelRequested = true;
    }
    await executeStep(session, this.opts);
    await this.persist(session);
    return session.run;
  }

  /**
   * Drive the run until it reaches a terminal state or would need external
   * input that is unavailable. Safety-bounded (no unbounded loops).
   */
  async run(runId: string, maxSteps = 200): Promise<RunRecord> {
    const session = this.sessions.get(runId);
    if (!session) throw new Error(`Unknown run ${runId}`);
    let steps = 0;
    while (!isTerminalState(session.run.state) && steps++ < maxSteps) {
      await this.stepOnce(runId);
    }
    return session.run;
  }

  async cancel(runId: string): Promise<RunRecord> {
    const session = this.sessions.get(runId);
    if (!session) throw new Error(`Unknown run ${runId}`);
    if (isTerminalState(session.run.state)) return session.run;
    (session.run as { cancelRequested?: boolean }).cancelRequested = true;
    const result = advance(engineContextOf(session), { ok: true });
    for (const t of result.applied) {
      this.opts.events.emit(runId, "state_changed", { from: t.from, to: t.to, reason: t.reason });
    }
    session.run.state = result.context.state;
    session.run.stopReason = result.stopReason ?? session.run.stopReason;
    session.run.finishedAt = session.run.finishedAt ?? new Date().toISOString();
    await this.persist(session);
    this.opts.events.emit(runId, "completed", {
      state: session.run.state,
      stopReason: session.run.stopReason,
    });
    return session.run;
  }

  private async persist(session: RunSession): Promise<void> {
    if (this.opts.persist) await this.opts.persist(session.run, session.ledger.snapshot());
  }
}

function isTerminalState(s: RunRecord["state"]): boolean {
  return ["READY_FOR_BUILD", "BLOCKED", "FAILED", "CANCELLED", "NEEDS_HUMAN_REVIEW"].includes(s);
}
