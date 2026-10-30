# Nebius x NVIDIA Global AI Hackathon

Track: **Coding and Agentic Engineering**. Project: **AutoDevSecOps AI**.

Requirements checked October 30, 2026 against the [overview](https://nebiusglobalaihackathon.devpost.com/) and [official rules](https://nebiusglobalaihackathon.devpost.com/rules).
Deadline: October 30, 2026, 10:00 a.m. PDT / 10:30 p.m. IST.
The rules define runtime inference on Token Factory as qualifying usage; hosting the entire application on Nebius is optional.

## Setup and judge reproduction

Requires Node >=20.11, npm, a Token Factory key with credits/model access.

```bash
npm install
cp .env.example .env
```

Edit `.env` locally (never commit it):

```dotenv
AI_PROVIDER=nebius
NEBIUS_API_KEY=<your private Token Factory key>
NEBIUS_BASE_URL=https://api.tokenfactory.us-central1.nebius.com/v1
NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b
QUEUE_DRIVER=memory
```

The model ID and regional endpoint follow [Nebius's Nemotron example](https://nebius.com/services/token-factory/nemotron). Confirm availability in your Token Factory account; if needed, copy an NVIDIA Nemotron model ID and HTTPS `/v1` endpoint from its playground. Never prefix the key with `VITE_`.

```bash
npm run typecheck
npm test
npx tsx scripts/security-scan.ts
npm run demo:nebius
```

The demo executes a failing SHA-256 regression test against a deliberately weak MD5 implementation. Nemotron receives the source and scanner finding through `POST /v1/chat/completions`, returns a schema-validated replacement, and the orchestrator applies it inside a temporary workspace. Actual `node --test` processes then run targeted and regression suites. The server-only demo explicitly requires `server:unit`; the application retains its default server and web suite requirements. The independent verifier checks the scanner rule cleared and the executed tests passed. JSON output includes provider/model, tokens, test results, verification and full fix-rate denominator/exclusions. Temporary files are deleted on completion. The demo does not contact GitLab, deploy software, or simulate a successful model call. A failed call exits unsuccessfully.

For the dashboard and real GitLab workflow, generate `CREDENTIAL_KEY_BASE64`, set `API_KEYS` with an explicit `:admin` role, then start `npm run dev:api` and `npm run dev:dashboard` in separate terminals. The API command loads root `.env`. Connect a test GitLab repository through Projects, select a revision and create a run. The GitLab token stays server-side, encrypted at rest. GitLab test repositories must already have their required runtimes and dependencies available in the execution environment; arbitrary dependency installation is not automatic. Use a disposable project and a dedicated execution environment. The CLI demo is the smallest reproducible model-and-test path.

## Observed live validation

On October 30, 2026, the local demo completed with `nvidia/nemotron-3-super-120b-a12b`: 672 reported tokens, a two-line patch, a failing baseline followed by two passing executed suites, independent verification, and `READY_FOR_BUILD`. Verified fixes: **1 / 1**, with **0 exclusions**. The [recorded result](nebius-validation.json) covers one fixture only and does not validate GitLab or public hosting.

Observed feedback: the documented OpenAI-compatible endpoint accepted JSON-object output for this fixture. The model produced a schema-valid patch and usage metadata. One live example is insufficient to estimate reliability or compare performance; complete personal feedback after further use.

## Requirements and remaining submission work

| Requirement | Implementation or action |
| --- | --- |
| NVIDIA open model on Nebius at runtime | Nemotron repair provider; verify with the live demo and record actual output |
| Appropriate track | Coding and Agentic Engineering |
| Working demo or test build URL | Publish the working app or a downloadable runnable build and provide judge instructions |
| Public code and open source license | MIT LICENSE added; make your repository public and supply its URL |
| Setup and model attribution | This guide and README |
| English description | Draft below; replace any unverified statement with actual observations |
| Public YouTube demonstration under three minutes | Record the storyboard below and upload publicly |
| Feedback on services used | Add your actual observations after the live run; do not invent feedback |
| Existing-project improvements | Explain prior baseline and these changes; confirm commit dates fall inside August 26–October 30, 2026 |
| Judge access | Keep the demo free and accessible through December 23, 2026, 12:00 p.m. Pacific Time |

Join the hackathon on Devpost as well as signing up for Token Factory. Account registration alone does not submit a project. Complete eligibility/team declarations yourself using the official rules. No submission or hosting publication has been performed by this repository change.

## Devpost description draft

**Tagline:** AI proposes a repair. Executed tests decide whether it worked.

**Problem:** Small engineering teams can find defects faster than they can confidently repair and release them. Generated patches need evidence before promotion.

**What it does:** AutoDevSecOps AI connects a GitLab issue ledger to a bounded review-and-repair loop. Deterministic scanners identify defects; NVIDIA Nemotron on Nebius Token Factory proposes minimal source patches. Schema validation and patch boundaries constrain changes. The platform executes tests and independently rescans the result before marking a finding fixed. Blocked issues remain visible. Deployment gates and approvals remain separate from model opinion.

**How we used Nebius and NVIDIA:** The explicit Nebius provider invokes NVIDIA Nemotron through Token Factory's OpenAI-compatible inference API during patch generation. It records the returned model and token usage in repair events. Token Factory supplies managed inference without requiring us to provision a GPU for patch reasoning. Test execution and GitLab I/O happen in our application environment, not inside Token Factory.

**Built with:** TypeScript, Zod, Node, React, Express, GitLab REST API, NVIDIA Nemotron, Nebius Token Factory; optional PostgreSQL and Redis for the existing platform.

**Significant updates to the existing project:** The original project provided deterministic repair transforms and optional GitLab Duo dispatch. The competition extension adds a dedicated Nebius runtime provider, Nemotron patch validation, usage evidence, failure handling, a real local model-and-test demo, repaired-revision test checkout, credential isolation for tests, and competition setup documentation. List the actual dated commits and observed results when submitting. Do not describe these additions as a newly created whole platform.

**Results:** [Fill in live model ID, tokens, latency, verified fixes, denominator/exclusions, and observed failures from your run. Local mocked tests are not evidence of hosted inference.]

**Feedback:** [Describe actual setup friction, JSON reliability, response latency, model availability, and one specific improvement after using the service.]

## Demo video storyboard (2:45)

- 0:00–0:20: Explain the developer problem and the rule that tests determine success.
- 0:20–0:45: Show the weak hash fixture and failing baseline test.
- 0:45–1:25: Run `npm run demo:nebius`; show the real repair event with NVIDIA model and usage. Hide terminals containing keys and account pages.
- 1:25–1:55: Show passing executed suites, independent rule verification and denominator/exclusions.
- 1:55–2:25: Show the GitLab/dashboard workflow only if you have actually connected and run it. Otherwise show the source patch boundary and recorded blocked outcomes, and clearly label the CLI scope.
- 2:25–2:45: Explain the existing-project extension and practical limitations. Show public repository and runnable demo/build links.

Record actual behavior; never replace a failed model call with fabricated success output.
