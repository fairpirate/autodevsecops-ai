# AutoDevSecOps AI — Review. Repair. Verify. Test. Deploy.

Production-oriented, AI-powered autonomous software quality assurance and
deployment platform for the GitLab Transcend hackathon.

## What it does

1. Connects to GitLab repositories (token encrypted at rest, never sent to AI agents).
2. Analyzes a selected branch/commit with deterministic analyzers + security review.
3. Stores every finding in a persistent **issue ledger** (deduplicated, evidenced).
4. Generates minimal AI-assisted repairs in isolated `autofix/*` branches.
5. Executes targeted + full regression tests; results are authoritative.
6. Runs **independent verification** that never trusts the repair agent's self-assessment.
7. Repeats the closed loop until quality gates pass or a stopping condition fires.
8. Builds one immutable artifact, promotes it DEVELOPMENT → STAGING → PRODUCTION
   with approvals, health checks, rollback, and full release evidence.
9. Shows everything live on a real-time dashboard (SSE + TanStack Query + Recharts).

## Quickstart (5 minutes, no GitLab required)

```bash
cp .env.example .env
# Generate a real credential key:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# put it in .env as CREDENTIAL_KEY_BASE64, and set API_KEYS

npm install
npm run typecheck
npm test
npm run dev:api      # control API on http://localhost:4000
npm run dev:dashboard # dashboard on http://localhost:5173 (proxies /api)
```

Health check: `GET http://localhost:4000/api/v1/health` → `{"status":"ok"}`.

### Full stack with Postgres + Redis (Docker Compose)

```bash
docker compose -f infrastructure/docker/docker-compose.yml up --build
# control-api :4000, dashboard :5173, postgres :5432, redis :6379
# orchestrator + execution-worker consume BullMQ queues (QUEUE_DRIVER=bullmq)
```

Set `STORE=prisma`, `DATABASE_URL=...`, `QUEUE_DRIVER=bullmq` in `.env`
for the persistent deployment (see `infrastructure/`).

## Demo end-to-end (no GitLab token needed)

The API test harness (`tests/fixtures/api-harness.ts`) runs the whole closed
loop against a fixture repo with real detectable defects (empty catch,
`innerHTML`, weak hash). Reproduce it live:

```bash
npm run dev:api
curl -X POST localhost:4000/api/v1/projects/connect \
  -H "Authorization: Bearer dev-admin-key" -H "Content-Type: application/json" \
  -d '{"gitlabBaseUrl":"https://gitlab.com","token":"glpat-...","gitlabProjectId":123}'
curl -X POST localhost:4000/api/v1/runs \
  -H "Authorization: Bearer dev-eng-key" -H "Content-Type: application/json" \
  -d '{"projectId":"<id>","ref":"main"}'
curl -N localhost:4000/api/v1/runs/<runId>/events?token=dev-eng-key
```
## GitLab Duo Agent Platform integration (real, not mocked)

**Status: real integration via the documented Flows API; deterministic
analyzers run when flows are disabled — never an unrelated LLM substitute.**

| Piece | Implementation |
|---|---|
| Trigger flow | `POST /api/v4/ai/duo_workflows/workflows` with `project_id`, `goal`, `workflow_definition`, `start_workflow`, `callback_hook_id`, `client_reference` (`services/gitlab-integration/src/duo-flows.ts`) |
| Status / trace | `GET .../workflows/:id`, `GET .../workflows/:id/trace.jsonl` (same file) |
| Callbacks | `POST /api/v1/webhooks/flow-callback` verifies `X-Gitlab-Token`, dedupes by `event_id`, correlates by `client_reference` (`services/gitlab-integration/src/webhooks.ts`) |
| Agent prompts | `agents/*/agent.md` — responsibilities, inputs, structured outputs, guardrails for all five agents |
| Registering agents/flows | Created in the GitLab UI under **AI > Agents / Flows** (AI Catalog); the repo holds prompt specs + CI wiring, not invented YAML keys (`agents/README.md`, `.gitlab/README.md`) |

**Prerequisites (GitLab side):** GitLab 18.8+ (flows GA 19.2); Duo Pro/Enterprise
or Duo Core on the top-level group; custom agents/flows turned on
(Settings > GitLab Duo); a project/group webhook with **Send Duo flow events to
this webhook** enabled; `GITLAB_FLOW_CALLBACK_HOOK_ID` set; a runner for CI.

```bash
DUO_FLOWS_ENABLED=true
DUO_FLOW_DEFINITION=developer/v1   # or custom flow id/version from the AI Catalog
GITLAB_FLOW_CALLBACK_HOOK_ID=42
```

When `DUO_FLOWS_ENABLED=false` (default), the orchestrator records AI tasks as
`unavailable`, continues with deterministic repairs, and labels the limitation
in run evidence.

## Architecture

```text
apps/dashboard       React+TS+Vite, Router, TanStack Query, Zustand, Recharts, SSE
apps/control-api     Express+TS+Zod REST, SSE bus, Prisma/Postgres or memory store
services/orchestrator  Closed-loop engine (INITIALIZED→…→READY_FOR_BUILD)
services/gitlab-integration  REST client (rate-limit/pagination), webhooks, Duo Flows API
services/execution-worker     Time-limited, secret-redacted test execution (+BullMQ)
services/artifact-service     Immutable artifacts, releases, provenance, approvals
packages/*           shared-types, workflow-engine, issue-ledger, policy-engine, test-adapters
agents/              Five agent specs (review/security/repair/verification/release)
infrastructure/      Dockerfiles, docker-compose, env + deployment manifests
.gitlab-ci.yml       validate → test → build → security → deploy (protected envs)
```

## API (versioned, authenticated, validated)

`Authorization: Bearer <API_KEYS entry>`; roles: `viewer` (read), `engineer`
(runs, deployments), `admin` (approvals, rollback, risk).

```text
POST /api/v1/projects/connect   GET /api/v1/projects  GET /api/v1/projects/:id
GET  /api/v1/projects/:id/branches|commits|merge-requests|pipelines
POST /api/v1/runs  GET /api/v1/runs  GET /api/v1/runs/:id
POST /api/v1/runs/:id/cancel  POST /api/v1/runs/:id/retry
GET  /api/v1/runs/:id/events (SSE)  GET /api/v1/runs/:id/issues|iterations|test-results
GET  /api/v1/issues/:id  POST /api/v1/issues/:id/disposition (admin)
GET  /api/v1/artifacts|releases  GET /api/v1/environments  GET /api/v1/deployments
POST /api/v1/deployments  POST /api/v1/deployments/:id/approve
POST /api/v1/deployments/:id/rollback
GET  /api/v1/metrics  GET|PUT /api/v1/policies  GET /api/v1/audit
POST /api/v1/webhooks/gitlab  POST /api/v1/webhooks/flow-callback
```

## Metrics that mean something

`verifiedFixRate = verified_fixed / (initial − accepted_risk − false_positive)` —
denominator and exclusions are always reported together. Patch pass-rate is
tracked separately and never conflated with defect-resolution rate.

## Security model

AES-256-GCM token vault; tokens never leave the server for AI agents; repair
workspaces get no production credentials; test output is secret-redacted;
webhooks verified with constant-time comparison + idempotency keys; flow
callbacks deduped by `event_id`; audit log on every sensitive action; repo text
never overrides policy (prompt-injection treated as untrusted input).

## Limitations (honest)

- Mobile: Android debug builds + API/startup checks implemented; iOS needs a
  macOS runner (documented, not claimed); Appium device testing is opt-in.
- Duo flows require the GitLab-side prerequisites above; without them the
  platform runs deterministically and says so.
- Local Docker Compose simulates env separation; real staging/production are
  the protected GitLab environments in CI.
