import { afterEach, describe, expect, it, vi } from "vitest";
import { API_AUTH_REQUIRED_EVENT, api, setApiKey } from "../../apps/dashboard/src/api.ts";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("dashboard API response handling", () => {
  function respond(body: string, contentType: string, status = 200) {
    vi.stubGlobal("localStorage", { getItem: () => "fixture-api-key" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      status, headers: { "Content-Type": contentType },
    })));
  }

  it("explains HTML fallback responses instead of showing a JSON parser error", async () => {
    respond("<!doctype html><html></html>", "text/html");
    await expect(api.projects()).rejects.toThrow("received HTML instead of API data");
  });

  it("explains non-JSON proxy failures", async () => {
    respond("", "text/plain", 502);
    await expect(api.projects()).rejects.toThrow("npm run dev:api");
  });

  it("preserves API authentication errors", async () => {
    respond(JSON.stringify({ error: { message: "Invalid API key" } }), "application/json", 401);
    await expect(api.projects()).rejects.toThrow("Invalid API key");
  });

  it("returns valid JSON data", async () => {
    respond(JSON.stringify({ items: [] }), "application/json; charset=utf-8");
    await expect(api.projects()).resolves.toEqual({ items: [] });
  });
});

describe("dashboard control API authentication", () => {
  function setup() {
    const storage = new Map([["ads_api_key", "old-dashboard-key"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    const window = new EventTarget();
    const rejected = vi.fn();
    window.addEventListener(API_AUTH_REQUIRED_EVENT, rejected);
    vi.stubGlobal("window", window);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    return { storage, rejected, fetcher };
  }
  function unauthorized() {
    return Response.json({ error: { code: "unauthorized", message: "Invalid control API key" } }, { status: 401 });
  }

  it("clears a rejected saved key and requests the key form again", async () => {
    const s = setup();
    s.fetcher.mockResolvedValue(unauthorized());
    await expect(api.projects()).rejects.toThrow("Invalid control API key");
    expect(s.storage.has("ads_api_key")).toBe(false);
    expect(s.rejected).toHaveBeenCalledOnce();
  });

  it("validates a candidate without saving it or disturbing the existing key", async () => {
    const s = setup();
    s.fetcher.mockResolvedValue(unauthorized());
    await expect(api.validateApiKey("candidate-key")).rejects.toThrow("Invalid control API key");
    expect(s.fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer candidate-key");
    expect(s.storage.get("ads_api_key")).toBe("old-dashboard-key");
    expect(s.rejected).not.toHaveBeenCalled();
  });

  it("uses the saved dashboard key ahead of a stale build-time key", async () => {
    const s = setup();
    vi.stubEnv("VITE_API_KEY", "stale-build-key");
    s.fetcher.mockResolvedValue(Response.json({ items: [] }));
    await api.projects();
    expect(s.fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer old-dashboard-key");
  });

  it("does not clear a new key when an older request returns unauthorized", async () => {
    const s = setup();
    let finish!: (response: Response) => void;
    s.fetcher.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const pending = api.projects();
    setApiKey("new-dashboard-key");
    finish(unauthorized());
    await expect(pending).rejects.toThrow("Invalid control API key");
    expect(s.storage.get("ads_api_key")).toBe("new-dashboard-key");
    expect(s.rejected).not.toHaveBeenCalled();
  });

  it("does not reset dashboard authentication for a GitLab authorization error", async () => {
    const s = setup();
    s.fetcher.mockResolvedValue(Response.json({ error: { code: "gitlab_error", message: "GitLab access denied" } }, { status: 401 }));
    await expect(api.connectProject({})).rejects.toThrow("GitLab access denied");
    expect(s.storage.get("ads_api_key")).toBe("old-dashboard-key");
    expect(s.rejected).not.toHaveBeenCalled();
  });
});
