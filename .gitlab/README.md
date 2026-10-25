# .gitlab — CI + Duo wiring notes

## CI pipeline (`.gitlab-ci.yml`)

`validate → test → build → security → deploy`, mirroring the platform
lifecycle. Runs on merge requests + the default branch.

**Prerequisites:** shared runners (or project runners with Docker);
`CI_POSTGRES_PASSWORD` protected variable; `staging` + `production` as
**protected environments** (Settings > CI/CD > Environments) so only
maintainers can deploy, and production is manual-only.

## Duo Agent Platform wiring (supported, no invented keys)

- Agents/flows are registered in the GitLab UI (**AI > Agents / Flows**, AI
  Catalog) using the prompt specs in `agents/*/agent.md` — the repo does not
  invent a YAML registration format.
- CI triggers real platform work via the Flows API from jobs that need it
  (example pattern below); the control API receives lifecycle events at
  `POST /api/v1/webhooks/flow-callback` (`callback_hook_id` +
  `client_reference` correlation, `event_id` dedupe).
- `GITLAB_FLOW_CALLBACK_HOOK_ID` = the project/group webhook ID with **Send
  Duo flow events to this webhook** enabled. `PUBLIC_BASE_URL` must be
  reachable from GitLab for callbacks.

```yaml
trigger-duo-review:
  stage: validate
  script:
    - >
      curl --request POST --header "PRIVATE-TOKEN: $DUO_API_TOKEN"
      --header "Content-Type: application/json"
      --data "{\"project_id\": \"$CI_PROJECT_ID\",
        \"goal\": \"Review commit $CI_COMMIT_SHA for defects; report structured findings\",
        \"workflow_definition\": \"$DUO_FLOW_DEFINITION\",
        \"start_workflow\": true,
        \"callback_hook_id\": $GITLAB_FLOW_CALLBACK_HOOK_ID,
        \"client_reference\": \"ci-$CI_PIPELINE_ID\"}"
      "$GITLAB_BASE_URL/api/v4/ai/duo_workflows/workflows"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

## Limitations

Without Duo prerequisites (license/credits, enabled custom flows, callback
webhook, runner), CI still validates/tests/builds/scans deterministically;
flow-dependent steps report `unavailable` instead of claiming success.
