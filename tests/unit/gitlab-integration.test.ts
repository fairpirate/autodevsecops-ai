import { describe, expect, it, vi } from "vitest";
import {
  GitLabClient,
  TokenVault,
  createGitLabService,
  hashApiKey,
  redactToken,
  verifyFlowCallback,
  verifyGitLabWebhook,
} from "@ads/gitlab-integration";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("TokenVault", () => {
  it("round-trips tokens and rejects tampered ciphertext", () => {
    const vault = new TokenVault(KEY);
    const token = "glpat-abcdef1234567890abcdef";
    const enc = vault.encrypt(token);
    expect(enc.startsWith("enc.v1.")).toBe(true);
    expect(enc).not.toContain(token);
    expect(vault.decrypt(enc)).toBe(token);
    expect(() => vault.decrypt(enc.slice(0, -2) + "xx")).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => new TokenVault(Buffer.alloc(16).toString("base64"))).toThrow();
  });
});

describe("redaction", () => {
  it("redacts tokens in log text", () => {
    const out = redactToken("using PRIVATE-TOKEN: glpat-secretvalue123 now");
    expect(out).not.toContain("secretvalue123");
    expect(hashApiKey("k").length).toBe(64);
  });
});

describe("GitLabClient", () => {
  it("retries on 429 respecting Retry-After, then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(JSON.stringify({ id: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new GitLabClient({
      baseUrl: "https://gitlab.example",
      token: "t",
      fetchImpl,
      sleep: async () => undefined,
    });
    const { data } = await client.request<{ id: number }>("GET", "/api/v4/projects/1");
    expect(data.id).toBe(1);
    expect(calls).toBe(2);
  });

  it("throws GitLabApiError with status on 404 without retrying", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const client = new GitLabClient({ baseUrl: "https://gitlab.example", token: "t", fetchImpl });
    await expect(client.request("GET", "/api/v4/projects/99")).rejects.toMatchObject({ status: 404 });
  });

  it("paginates using x-next-page", async () => {
    const pages: Record<string, { body: unknown[]; next: string }> = {
      "1": { body: [{ id: 1 }], next: "2" },
      "2": { body: [{ id: 2 }], next: "" },
    };
    const fetchImpl = (async (url: string) => {
      const page = new URL(url).searchParams.get("page") ?? "1";
      const p = pages[page];
      return new Response(JSON.stringify(p.body), {
        status: 200,
        headers: p.next ? { "x-next-page": p.next } : {},
      });
    }) as unknown as typeof fetch;
    const client = new GitLabClient({ baseUrl: "https://gitlab.example", token: "t", fetchImpl });
    const all = await client.paginateAll<{ id: number }>("/api/v4/projects/1/repository/commits");
    expect(all.map((c) => c.id)).toEqual([1, 2]);
  });
});

describe("webhook validation", () => {
  const secret = "shh-secret";

  it("rejects bad tokens", () => {
    const r = verifyGitLabWebhook({ "x-gitlab-token": "wrong" }, JSON.stringify({}), secret);
    expect(r).toEqual({ ok: false, reason: "bad_token" });
  });

  it("verifies a push event and derives a stable idempotency key", () => {
    const payload = JSON.stringify({
      object_kind: "push",
      before: "111",
      after: "222",
      project: { id: 42, path_with_namespace: "g/p" },
    });
    const a = verifyGitLabWebhook({ "x-gitlab-token": secret }, payload, secret);
    const b = verifyGitLabWebhook({ "x-gitlab-token": secret }, payload, secret);
    expect(a.ok).toBe(true);
    if (a.ok && b.ok) expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });

  it("verifies duo flow callbacks and dedupes by event_id", () => {
    const payload = JSON.stringify({
      event: "flow.completed",
      event_id: "evt-1",
      workflow_id: 7,
      client_reference: "run:abc:iter:1:i1",
    });
    const r = verifyFlowCallback({ "x-gitlab-token": secret }, payload, secret);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dedupeKey).toBe("evt-1");
  });

  it("rejects malformed payloads", () => {
    const r = verifyFlowCallback({ "x-gitlab-token": secret }, "not-json", secret);
    expect(r).toEqual({ ok: false, reason: "invalid_payload" });
  });
});

describe("Duo flows client", () => {
  it("refuses to run when disabled instead of substituting another LLM", async () => {
    const { duoFlows } = createGitLabService({ baseUrl: "https://gitlab.example", token: "t" });
    await expect(
      duoFlows.startFlow({ project_id: "1", goal: "x", workflow_definition: "developer/v1", start_workflow: true }),
    ).rejects.toThrow(/disabled/i);
  });

  it("posts to the documented flows endpoint when enabled", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: 5, status: "pending" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const { duoFlows } = createGitLabService({
      baseUrl: "https://gitlab.example",
      token: "t",
      duoFlowsEnabled: true,
      fetchImpl,
    });
    const wf = await duoFlows.startFlow({
      project_id: "1",
      goal: "fix the build",
      workflow_definition: "developer/v1",
      start_workflow: true,
      client_reference: "run:abc",
    });
    expect(wf.id).toBe(5);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0];
    expect(url).toContain("/api/v4/ai/duo_workflows/workflows");
    expect((init.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe("t");
    expect(JSON.parse(String(init.body)).start_workflow).toBe(true);
  });
});
