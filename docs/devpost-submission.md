# Autonomous DevSecOps AI Platform

**Review. Repair. Verify. Test. Deploy.**

## Inspiration

Finding a software defect is only the beginning. Developers still need to understand it, write a repair, run the right tests, check for regressions, and decide whether the change is safe to release. Small teams often carry out this work across separate review, security, CI, and deployment tools.

We wanted to connect those steps into a workflow that makes each repair accountable. Our guiding principle is simple: AI can propose a fix, but executed tests and independent checks must determine whether it worked.

The Nebius x NVIDIA hackathon gave us an opportunity to extend our existing DevSecOps platform with NVIDIA Nemotron inference through Nebius Token Factory. We chose the Coding and Agentic Engineering track because our focus is helping developers turn detected defects into verifiable repairs.

## What it does

Autonomous DevSecOps AI Platform organizes software quality work into a bounded review-and-repair loop:

1. Connect a GitLab project and select a source revision.
2. Run deterministic code and security checks, recording findings in an issue ledger.
3. Request a focused repair from NVIDIA Nemotron through Nebius Token Factory.
4. Validate the returned JSON and enforce source-file and patch-size restrictions before applying a change to an isolated repair branch.
5. Execute targeted and regression tests against the repaired revision.
6. Independently rescan the code and review the evidence before marking an issue fixed.

The dashboard exposes runs, issues, test results, and workflow events. Findings that cannot be repaired or verified remain visible. Release policies and approval requirements govern promotion separately from the model's claims.

For a reproducible demonstration without GitLab setup, we also provide a local CLI demo. It starts with a weak-hash implementation and a failing test, requests a real model-generated repair, executes the tests again, and reports the verification result.

## How we built it

The application uses a TypeScript monorepo with a React dashboard, an Express control API, and a workflow orchestrator. Zod validates request and model-response boundaries. The existing platform includes GitLab REST integration and optional PostgreSQL persistence through Prisma.

Our competition extension adds an explicit Nebius provider that calls the Token Factory chat-completions API using `nvidia/nemotron-3-super-120b-a12b`. It sends the relevant source file and finding, validates the proposed replacement, and records the returned model and token usage. Token Factory supplies hosted inference; our application environment handles GitLab operations and test execution.

GitLab credentials stay on the server and are encrypted at rest. The Nebius key is used for API authentication and is not included in model prompts. The repair path rejects detected credential material and excludes sensitive paths, tests, and configuration files from model edits.

The project existed before this competition extension. The new work includes Nebius inference, patch validation, usage evidence, failure handling, the live model-and-test demo, repaired-commit checkout, dashboard API routing fixes, and VPS Nginx configuration. The current Nebius workflow runs in the embedded orchestrator; distributed execution is future work.

## Challenges we ran into

**Separating a plausible repair from a verified fix.** A model explanation cannot establish correctness. We kept test execution and scanner results outside the model's control and made unsuccessful or inconclusive outcomes explicit.

**Testing the correct revision.** We found that committing a repair was insufficient if tests still ran against the original checkout. We updated the GitLab host to fetch and check out the repaired commit and to base successive repairs on the preceding revision.

**Handling inference failures and invalid output.** Responses can be incomplete, malformed, or outside the permitted scope. We added schema validation, timeouts, token-budget checks, and patch restrictions. A rejected response blocks the repair instead of becoming a claimed success.

**Connecting the dashboard to the API.** A missing proxy caused API requests to receive HTML, producing the familiar “Unexpected token '<'” JSON error. We added Vite proxy configuration, clearer response errors, and a VPS Nginx configuration that keeps `/api/` traffic separate from the frontend's HTML fallback.

## Accomplishments that we're proud of

We completed a real hosted-inference demonstration with a failing baseline, a Nemotron-generated repair, executed tests, independent verification, and a final `READY_FOR_BUILD` state.

In the recorded run, Nemotron produced a two-line repair using **672 reported tokens**. Both targeted and regression executions passed. The result was **1 verified fix out of 1 finding, with 0 exclusions**. This demonstrates one local fixture; it does not establish general repair accuracy or prove a production deployment.

Our validation suite passed **104 tests across 15 files**, including provider boundaries, failed repair paths, GitLab revision handling, API integration, and dashboard proxy behavior. TypeScript checks and the dashboard production build also passed.

We also prepared an MIT-licensed repository, reproducible setup instructions, live validation evidence, and HTTPS deployment configuration for the VPS.

## What we learned

The most important part of an autonomous coding workflow is the evidence surrounding a change. Model output becomes useful when it is tied to a specific source revision, constrained by policy, tested, and independently reviewed.

We also learned that failure handling is part of the product experience. Users need to distinguish a model failure, a rejected patch, a failed test, and a configuration problem. Reporting those outcomes clearly makes the system easier to trust and debug.

Token Factory let us exercise NVIDIA Nemotron through a hosted API without provisioning a GPU for this prototype. Our live example returned usable structured output and token metadata, but broader evaluation is needed to understand reliability, latency, and cost across different repair tasks.

## What's next for Autonomous DevSecOps AI Platform

- Expand evaluation beyond the weak-hash fixture to representative defects and real GitLab repositories, reporting verified-fix rates with denominators and exclusions.
- Support carefully constrained multi-file repairs and generated regression tests, with independent checks against weakened assertions or removed behavior.
- Add distributed Nebius orchestration, durable execution recovery, and stronger isolation for repository test processes.
- Evaluate Nemotron models on repair quality, latency, and token usage using the same reproducible tasks.
- Improve the dashboard's presentation of patch evidence and approval decisions, then validate the complete hosted GitLab-to-release workflow in staging.

Our goal is to reduce the work between discovering a defect and producing an evidence-backed repair, while keeping consequential release decisions under explicit control.
