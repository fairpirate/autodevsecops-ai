# Agents — GitLab Duo Agent Platform mapping

The five platform responsibilities are specified as agent prompt packs in
`agents/<name>/agent.md`. Each pack defines the role, inputs, structured
machine-readable outputs, and guardrails.

**How they run on GitLab (supported path, verified against docs):**

- Custom agents and flows are created in the GitLab UI under **AI > Agents /
  Flows** (AI Catalog) — there is no repo-YAML registration format to invent.
  The prompt packs here are the source of truth you paste into the agent
  definition when registering.
- At runtime the platform dispatches AI work through the **Flows API**:
  `POST /api/v4/ai/duo_workflows/workflows` with `project_id`, `goal`,
  `workflow_definition`, `start_workflow: true`, `callback_hook_id`,
  `client_reference`. Progress/completion arrives at
  `POST /api/v1/webhooks/flow-callback`.
- Docs: https://docs.gitlab.com/user/duo_agent_platform/ ,
  https://docs.gitlab.com/api/duo_agent_platform_flows/ ,
  https://docs.gitlab.com/user/duo_agent_platform/flows/webhook_callbacks/

**Fallback (explicit, never a substitute claim):** when `DUO_FLOWS_ENABLED=false`,
the orchestrator uses the deterministic analyzers/repairs in
`services/orchestrator/src/` and records AI tasks as `unavailable` in run
evidence. No unrelated LLM API is ever presented as the GitLab platform.

| Agent | Spec | Code counterpart |
|---|---|---|
| A — Code Review | `agents/code-review/agent.md` | `services/orchestrator/src/analyzers.ts` (`runCodeReview`) |
| B — Security Review | `agents/security-review/agent.md` | `analyzers.ts` (`runSecurityReview`) + scans |
| C — AI Repair | `agents/repair/agent.md` | `services/orchestrator/src/repair.ts` |
| D — Independent Verification | `agents/verification/agent.md` | `services/orchestrator/src/verification.ts` |
| E — Release | `agents/release/agent.md` | `packages/policy-engine` + `services/artifact-service` |

**Prerequisites:** GitLab 18.8+ with Duo (Pro/Enterprise, or Duo Core on the
top-level group); custom agents/flows enabled (Settings > GitLab Duo);
credits for billable flow usage (Free tier needs a credit pool); a webhook with
**Send Duo flow events to this webhook** enabled. Without these, the platform
runs deterministically and labels the limitation.
