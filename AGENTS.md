# AGENTS.md — working agreement for humans and AI contributors

## Project identity

AutoDevSecOps AI: Review. Repair. Verify. Test. Deploy. A full-stack
autonomous QA + deployment platform with real GitLab integration
(no mock-only dashboards, no invented platform endpoints).

## Conventions

- TypeScript strict; Zod validates every request boundary; no `any` leaks.
- Packages expose pure logic + unit tests; services own I/O; `apps/control-api`
  owns HTTP; the orchestrator owns workflow state (never trusts agent
  self-assessment — `services/orchestrator/src/verification.ts`).
- Structured agent outputs are JSON (see `agents/*/agent.md`); executed test
  and scanner output is authoritative over AI opinion.
- Tokens encrypted at rest (AES-256-GCM vault); never sent to AI agents;
  secret-redact all logs (`redactSecrets`); webhooks verified + idempotent.
- Verified-fix rate always reports denominator + exclusions together.
- Never claim Android builds prove iOS compatibility; never promise mobile
  auto-installation; never deploy unverified patches to production.
- GitLab Duo integration uses ONLY documented endpoints/keys
  (`POST /api/v4/ai/duo_workflows/workflows`, `callback_hook_id`,
  `client_reference`, `event_id` dedupe). Never invent config keys or
  endpoints; document prerequisites and fallback behavior instead.

## Commands

- `npm install` → `npm run typecheck` → `npm test` (must stay green).
- `npm run dev:api`, `npm run dev:dashboard`, `npm run dev:orchestrator`, `npm run dev:worker`.
- `npm run db:generate|db:migrate|db:deploy` for Prisma; `db:seed` for demo data.
- `docker compose -f infrastructure/docker/docker-compose.yml up --build`.

## Definition of done

Typecheck clean, full `vitest run` green (unit + integration + e2e +
regression), no secrets committed (`npx tsx scripts/security-scan.ts`), README
limitations section updated when a claim can't be demonstrated.
