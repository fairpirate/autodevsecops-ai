import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../apps/dashboard/src/api.ts";

afterEach(() => vi.unstubAllGlobals());

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
