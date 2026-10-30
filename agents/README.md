# Executable agents and prompt specifications

The Markdown files are role specifications, not executable programs. The application
already runs these roles through the orchestrator and policy services. Each folder
now also contains a `run.ts` entry point so you can exercise the same implementation
independently with validated JSON input and structured JSON output.

| Role | Executable entry point | Implementation used by the application |
| --- | --- | --- |
| Code Review | `agents/code-review/run.ts` | `services/orchestrator/src/analyzers.ts`: code rules and missing-test findings |
| Security Review | `agents/security-review/run.ts` | `services/orchestrator/src/analyzers.ts`: deterministic security rules |
| Repair | `agents/repair/run.ts` | `services/orchestrator/src/repair.ts` or `nebius.ts`: explicit provider selection |
| Independent Verification | `agents/verification/run.ts` | `services/orchestrator/src/verification.ts`: rule, diff, test and scan evidence |
| Release | `agents/release/run.ts` | `packages/policy-engine` and `services/artifact-service`: gates, approvals, promotion and identity |

`services/orchestrator/src/agent-runtime.ts` dispatches these standalone requests;
`agent-schemas.ts` defines their Zod contracts. `agent-cli.ts` owns file/stdin I/O,
provider configuration and output redaction. The CLI does not create workflow
sessions, save GitLab tokens, commit patches, approve releases or deploy software.

## Run the agents

From the repository root:

```bash
npm install
npm run typecheck
npm run agent:code-review -- --input agents/examples/review.json
npm run agent:security-review -- --input agents/examples/review.json
npm run agent:repair -- --input agents/examples/repair.json
npm run agent:verification -- --input agents/examples/verification.json
npm run agent:release -- --input agents/examples/release.json
```

For stdout containing only JSON, use npm's silent option:

```bash
npm run --silent agent:security-review -- --input agents/examples/review.json
```

All entry points also accept JSON on stdin when `--input` is omitted:

```bash
node --import tsx agents/code-review/run.ts < agents/examples/review.json
```

Inputs are limited to 2 MiB. Invalid JSON, schema errors and execution errors
produce a JSON error on stderr and exit code 1. Exit code 0 means a request was
processed: inspect `status`, `decision.verdict`, `eligible` and findings before
making any decision. A blocked or inconclusive outcome is a valid agent result.

## Input and output contracts

- **Review/security:** provide `runId`, `commitSha` and `files` (relative repository
  paths mapped to source text); `changedPaths` is optional. Returns deduplicated
  issue records in `findings`, labelled `mode: deterministic`. These rules do not
  implement every aspirational check in the prompt specs.
- **Repair:** provide a triaged `issue`, `files`, optional `iteration` and
  `maxPatchSizeLines`, and `provider` (`deterministic` by default). Returns
  `status: proposed` with a `RepairAttempt`, or `status: blocked` with a reason.
  `applied` is always false. Proposal generation does not execute tests.
- **Verification:** provide `issue`, `repair` (including its applied `commitSha`),
  `filesAfter`, executed `targetedTests` and `regressionTests`, and
  `securityScanPassed`. Issue IDs and test revisions must match. Missing tests,
  an unexecuted scan, or an unknown verification rule cannot establish a fix.
- **Release:** provide `release`, `artifact`, target `environment`, `issues`,
  executed `testResults` and `securityScanPassed`; production also needs the
  `priorStagingDigest` and recorded approvals. Reports identity, gates and
  eligibility without deploying or creating approvals. The default policy requires
  `server:unit` and `web:unit` suites.

The verification and release commands are **advisory evaluations of supplied
records**. They cannot authenticate JSON evidence or human approvals supplied on
stdin. Production authority remains in the orchestrator and authenticated API,
which obtain evidence from their execution hosts and stores.

The examples deliberately contain no fabricated passing test results. The
verification example returns `inconclusive`; the release example is ineligible.
To see real model inference followed by actual test execution, use
`npm run demo:nebius` instead.

## Explicit Nebius repair

Make a copy of `agents/examples/repair.json` with `"provider": "nebius"`. Configure
`NEBIUS_API_KEY` privately in `.env`, then load that environment explicitly:

```bash
node --env-file=.env --import tsx agents/repair/run.ts --input /path/to/repair-nebius.json
```

This consumes inference credits. The default commands do not load `.env`, do not
select Nebius from `AI_PROVIDER`, and do not make GitLab calls. The Nebius adapter
restricts source paths and patch size and validates the returned model response.
Neither repair mode may edit tests, configuration or credential files through
these standalone entry points. Secret detection/redaction is heuristic: use
sanitized source inputs and never place credentials in input examples.

## GitLab Duo prompt specifications

The `agent.md` files remain useful specifications for optional custom GitLab Duo
agents/flows. They are not automatically registered or executed by their presence
in this repository. The GitLab integration service contains flow-dispatch support;
these standalone commands do not dispatch Duo flows. Follow `.gitlab/README.md`
for the separate integration and its prerequisites. Nebius inference is explicitly
labelled as Nebius and is not presented as a GitLab Duo execution.
