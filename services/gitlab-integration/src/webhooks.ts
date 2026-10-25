import { createHash } from "node:crypto";
import { z } from "zod";
import { safeEqual } from "./crypto";

/* ------------------------------------------------------------------ *
 * Incoming GitLab webhooks (push / pipeline / MR) — POST /api/v1/webhooks/gitlab
 * ------------------------------------------------------------------ */

const baseEventSchema = z.object({
  object_kind: z.string().optional(),
  event_type: z.string().optional(),
  project: z.object({ id: z.number(), path_with_namespace: z.string().optional() }).passthrough().optional(),
  repository: z.object({ name: z.string().optional() }).passthrough().optional(),
  refs: z.array(z.string()).optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  checkout_sha: z.string().nullable().optional(),
  merge_request: z.object({ iid: z.number(), state: z.string(), action: z.string().optional() }).passthrough().optional(),
  object_attributes: z.object({ action: z.string().optional() }).passthrough().optional(),
}).passthrough();

export type GitLabWebhookEvent = z.infer<typeof baseEventSchema>;

export type WebhookVerifyResult =
  | { ok: true; event: GitLabWebhookEvent; idempotencyKey: string }
  | { ok: false; reason: "bad_token" | "invalid_payload" };

/**
 * Validate `X-Gitlab-Token` with constant-time comparison and parse payload.
 * Idempotency key = event UUID when present, else sha256(project, before, after, kind).
 */
export function verifyGitLabWebhook(
  headers: Record<string, string | undefined>,
  rawBody: string,
  secret: string,
): WebhookVerifyResult {
  const token = headers["x-gitlab-token"] ?? headers["X-Gitlab-Token"];
  if (!token || !safeEqual(token, secret)) return { ok: false, reason: "bad_token" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
  const result = baseEventSchema.safeParse(parsed);
  if (!result.success) return { ok: false, reason: "invalid_payload" };

  const evt = result.data;
  const objUuid = (evt as { uuid?: string }).uuid;
  const idempotencyKey = objUuid
    ? `gl-${objUuid}`
    : `gl-${createHash("sha256")
        .update(
          [
            evt.object_kind ?? "unknown",
            String(evt.project?.id ?? evt.repository?.name ?? "-"),
            evt.before ?? "-",
            evt.after ?? evt.checkout_sha ?? "-",
            String(evt.merge_request?.iid ?? "-"),
            String((evt.object_attributes as { id?: number } | undefined)?.id ?? "-"),
          ].join("|"),
        )
        .digest("hex")
        .slice(0, 32)}`;

  return { ok: true, event: evt, idempotencyKey };
}

/* ------------------------------------------------------------------ *
 * GitLab Duo flow callbacks (flow.started / completed / failed / progress)
 * Docs: https://docs.gitlab.com/user/duo_agent_platform/flows/webhook_callbacks/
 * ------------------------------------------------------------------ */

export const flowEventSchema = z
  .object({
    event_id: z.string().optional(),
    event: z.enum(["flow.started", "flow.completed", "flow.failed", "flow.progress", "flow.queued"]),
    workflow_id: z.union([z.string(), z.number()]).optional(),
    status: z.string().optional(),
    client_reference: z.string().optional().nullable(),
    project_id: z.union([z.string(), z.number()]).optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
    progress: z.unknown().optional(),
  })
  .passthrough();

export type FlowEvent = z.infer<typeof flowEventSchema>;

export type FlowCallbackResult =
  | { ok: true; event: FlowEvent; dedupeKey: string }
  | { ok: false; reason: "bad_token" | "invalid_payload" };

/**
 * Flow callbacks arrive as ordinary webhook deliveries (same headers), so the
 * signing token must be verified. Deliveries can repeat — derive a dedupe key
 * from event_id when present (docs: store processed event_ids, ignore repeats).
 */
export function verifyFlowCallback(
  headers: Record<string, string | undefined>,
  rawBody: string,
  secret: string,
): FlowCallbackResult {
  const token = headers["x-gitlab-token"] ?? headers["X-Gitlab-Token"];
  if (!token || !safeEqual(token, secret)) return { ok: false, reason: "bad_token" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
  const result = flowEventSchema.safeParse(parsed);
  if (!result.success) return { ok: false, reason: "invalid_payload" };
  const event = result.data;
  const dedupeKey =
    event.event_id ??
    `${event.event}:${String(event.workflow_id ?? "-")}:${String(event.client_reference ?? "-")}`;
  return { ok: true, event, dedupeKey };
}
