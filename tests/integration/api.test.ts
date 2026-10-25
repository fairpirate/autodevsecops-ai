import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { ADMIN_KEY, ENG_KEY, SHA, VIEWER_KEY, createHarness, type Harness } from "../fixtures/api-harness";

describe("control-api: auth, projects, runs, events", () => {
  let h: Harness;

  beforeAll(async () => {
    h = createHarness();
    await h.start();
  });
  afterAll(async () => {
    await h.stop();
  });

  it("serves health without auth", async () => {
    const res = await request(h.base).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rejects unauthenticated and wrong-key requests", async () => {
    expect((await request(h.base).get("/api/v1/runs")).status).toBe(401);
    const bad = await request(h.base).get("/api/v1/runs").set("Authorization", "Bearer nope");
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("unauthorized");
  });

  it("connects a GitLab project and encrypts the token at rest", async () => {
    const res = await request(h.base)
      .post("/api/v1/projects/connect")
      .set("Authorization", `Bearer ${ADMIN_KEY}`)
      .send({ gitlabBaseUrl: "https://gitlab.example", token: "glpat-testtoken123456", gitlabProjectId: 123 });
    expect(res.status).toBe(201);
    expect(res.body.project.pathWithNamespace).toBe("group/demo");
    expect(res.body.project.tokenEncrypted).toBeUndefined();

    const row = (await h.store.projects.getByGitlabId(123))!;
    expect(row.tokenEncrypted).not.toContain("glpat-testtoken123456");
    expect(h.vault.decrypt(row.tokenEncrypted)).toBe("glpat-testtoken123456");
  });

  it("validates connect payloads", async () => {
    const res = await request(h.base)
      .post("/api/v1/projects/connect")
      .set("Authorization", `Bearer ${ADMIN_KEY}`)
      .send({ token: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("runs the closed loop from POST /runs to READY_FOR_BUILD with evidence", async () => {
    const projectId = await h.connectProject();
    const created = await request(h.base)
      .post("/api/v1/runs")
      .set("Authorization", `Bearer ${ENG_KEY}`)
      .send({ projectId, ref: "main", commitSha: SHA });
    expect(created.status).toBe(202);

    const run = await h.waitForRun(created.body.run.id, ["READY_FOR_BUILD", "BLOCKED", "FAILED"]);
    expect(run.state).toBe("READY_FOR_BUILD");

    const detail = await request(h.base)
      .get(`/api/v1/runs/${run.id}`)
      .set("Authorization", `Bearer ${ENG_KEY}`);
    expect(detail.status).toBe(200);
    expect(detail.body.issues.length).toBeGreaterThanOrEqual(3);
    expect(detail.body.metrics.verifiedFixes).toBeGreaterThanOrEqual(3);
    expect(detail.body.metrics.verifiedFixRate).toBeGreaterThan(0);

    const tests = await request(h.base)
      .get(`/api/v1/runs/${run.id}/test-results`)
      .set("Authorization", `Bearer ${ENG_KEY}`);
    expect(tests.body.items.length).toBeGreaterThanOrEqual(2);

    const issueId = detail.body.issues[0].id;
    const issue = await request(h.base).get(`/api/v1/issues/${issueId}`).set("Authorization", `Bearer ${ENG_KEY}`);
    expect(issue.status).toBe(200);
    expect(issue.body.issue.history.length).toBeGreaterThan(0);
    expect(issue.body.issue.evidence.length).toBeGreaterThan(0);

    const iterations = await request(h.base)
      .get(`/api/v1/runs/${run.id}/iterations`)
      .set("Authorization", `Bearer ${ENG_KEY}`);
    expect(iterations.body.items.length).toBeGreaterThanOrEqual(1);

    const runs = await request(h.base).get("/api/v1/runs").set("Authorization", `Bearer ${ENG_KEY}`);
    expect(runs.body.total).toBeGreaterThanOrEqual(1);
    expect(runs.body.items[0].commitSha).toBe(SHA);
  });
  it("cancels a run and refuses double-cancel", async () => {
    const projectId = await h.connectProject();
    const created = await request(h.base)
      .post("/api/v1/runs")
      .set("Authorization", `Bearer ${ENG_KEY}`)
      .send({ projectId, ref: "main", commitSha: SHA });
    const cancel = await request(h.base)
      .post(`/api/v1/runs/${created.body.run.id}/cancel`)
      .set("Authorization", `Bearer ${ENG_KEY}`);
    if (cancel.status === 200) {
      expect(cancel.body.run.state).toBe("CANCELLED");
      const again = await request(h.base)
        .post(`/api/v1/runs/${created.body.run.id}/cancel`)
        .set("Authorization", `Bearer ${ENG_KEY}`);
      expect(again.status).toBe(409);
    } else {
      expect(cancel.status).toBe(409);
    }
  });

  it("retries a terminal run as a child run", async () => {
    const runId = await h.createCompletedRun();
    const retry = await request(h.base)
      .post(`/api/v1/runs/${runId}/retry`)
      .set("Authorization", `Bearer ${ENG_KEY}`);
    expect(retry.status).toBe(202);
    expect(retry.body.run.parentRunId).toBe(runId);
  });

  it("streams historical events over SSE", async () => {
    const runId = await h.createCompletedRun();
    const controller = new AbortController();
    const res = await fetch(`${h.base}/api/v1/runs/${runId}/events?token=${ENG_KEY}`, {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    const started = Date.now();
    while (buffered.split("event: run-event").length < 3 && Date.now() - started < 5000) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
    }
    controller.abort();
    expect(buffered).toContain("event: run-event");
    expect(buffered).toContain("state_changed");
  });

  it("enforces viewer role as read-only", async () => {
    const projectId = await h.connectProject();
    const res = await request(h.base)
      .post("/api/v1/runs")
      .set("Authorization", `Bearer ${VIEWER_KEY}`)
      .send({ projectId, ref: "main", commitSha: SHA });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("exposes aggregate metrics", async () => {
    const res = await request(h.base).get("/api/v1/metrics").set("Authorization", `Bearer ${ADMIN_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.connectedProjects).toBeGreaterThanOrEqual(1);
    expect(res.body.totalFindings).toBeGreaterThan(0);
    expect(res.body.verifiedFixes).toBeGreaterThan(0);
    expect(res.body.testPassRate === null || typeof res.body.testPassRate === "number").toBe(true);
  });

});
