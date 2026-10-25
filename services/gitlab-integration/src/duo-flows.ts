import type { GitLabClient } from "./client";

/**
 * Client for the GitLab Duo Agent Platform **Flows API**.
 * Docs: https://docs.gitlab.com/api/duo_agent_platform_flows/
 *
 * Endpoints (verified against official docs):
 *   POST /api/v4/ai/duo_workflows/workflows      — trigger + start a flow
 *   GET  /api/v4/ai/duo_workflows/workflows/:id  — workflow status
 *   GET  /api/v4/ai/duo_workflows/workflows/:id/trace.jsonl — NDJSON trace
 *   GET  /api/v4/ai/duo_workflows/workflows/agent_privileges
 *
 * Auth: PRIVATE-TOKEN header with a token that has AI workflow scope.
 * `workflow_definition` must reference a registered flow (foundational flow
 * like `developer/v1`, or a custom flow id/version from the AI Catalog).
 */
export interface StartFlowRequest {
  project_id: string;
  goal: string;
  workflow_definition: string;
  start_workflow: boolean;
  /** Project/group webhook ID with "Send Duo flow events to this webhook" enabled (GitLab >= 19.5). */
  callback_hook_id?: number;
  /** Echoed back on every callback for correlation. */
  client_reference?: string;
}

export interface FlowWorkflow {
  id: number;
  status?: string;
  name?: string;
  result?: unknown;
  [k: string]: unknown;
}

export interface AgentPrivilege {
  id: number;
  name: string;
  description: string;
  default_enabled: boolean;
}

export class DuoFlowsClient {
  constructor(
    private readonly client: GitLabClient,
    private readonly opts: { enabled: boolean },
  ) {}

  get isEnabled(): boolean {
    return this.opts.enabled;
  }

  /**
   * Trigger and start a flow. Throws `DisabledError` when DUO_FLOWS_ENABLED
   * is false so callers fall back to deterministic analysis (never pretending
   * an unrelated LLM call is the GitLab platform).
   */
  async startFlow(req: StartFlowRequest): Promise<FlowWorkflow> {
    this.assertEnabled();
    const { data } = await this.client.request<FlowWorkflow>(
      "POST",
      "/api/v4/ai/duo_workflows/workflows",
      { body: { ...req, start_workflow: true } },
    );
    return data;
  }

  async getWorkflow(id: number | string): Promise<FlowWorkflow> {
    this.assertEnabled();
    const { data } = await this.client.request<FlowWorkflow>(
      "GET",
      `/api/v4/ai/duo_workflows/workflows/${id}`,
    );
    return data;
  }

  /** NDJSON chat/progress trace (one JSON object per line). */
  async getTrace(id: number | string, thread?: string): Promise<Array<Record<string, unknown>>> {
    this.assertEnabled();
    const { data } = await this.client.request<string>(
      "GET",
      `/api/v4/ai/duo_workflows/workflows/${id}/trace.jsonl`,
      { query: { thread }, raw: true },
    );
    return data
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  async listAgentPrivileges(): Promise<AgentPrivilege[]> {
    this.assertEnabled();
    const { data } = await this.client.request<{ all_privileges: AgentPrivilege[] }>(
      "GET",
      "/api/v4/ai/duo_workflows/workflows/agent_privileges",
    );
    return data.all_privileges ?? [];
  }

  private assertEnabled(): void {
    if (!this.opts.enabled) {
      throw new DisabledError(
        "GitLab Duo Flows execution is disabled (DUO_FLOWS_ENABLED=false). " +
          "Deterministic analyzers are used instead; no LLM substitute is claimed.",
      );
    }
  }
}

export class DisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisabledError";
  }
}
