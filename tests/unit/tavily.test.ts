import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTavilySearcher, TavilyError, type TavilySearchInput } from "../../services/orchestrator/src/tavily";

const mockSearch = vi.fn();
vi.mock("@tavily/core", () => ({
  tavily: vi.fn(() => ({ search: mockSearch })),
}));

const validInput: TavilySearchInput = { query: "lodash CVE advisory", maxResults: 3 };

beforeEach(() => {
  mockSearch.mockClear();
});

function mockResponse(results: Array<{ title: string; url: string; content: string; score: number; publishedDate?: string }>, answer?: string) {
  mockSearch.mockResolvedValue({ query: validInput.query, answer, results });
}

describe("Tavily searcher", () => {
  it("searches and maps results correctly", async () => {
    mockResponse([
      { title: "CVE-2024-1234", url: "https://cve.example/1234", content: "lodash is vulnerable", score: 0.95, publishedDate: "2024-01-01" },
    ], "Upgrade lodash to 4.18.0");

    const searcher = createTavilySearcher("test-key");
    const res = await searcher.search(validInput);

    expect(mockSearch).toHaveBeenCalledTimes(1);
    const [query, opts] = mockSearch.mock.calls[0];
    expect(query).toBe("lodash CVE advisory");
    expect(opts.maxResults).toBe(3);
    expect(opts.includeAnswer).toBe(true);
    expect(opts.searchDepth).toBe("basic");
    expect(res.query).toBe("lodash CVE advisory");
    expect(res.answer).toBe("Upgrade lodash to 4.18.0");
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({
      title: "CVE-2024-1234",
      url: "https://cve.example/1234",
      content: "lodash is vulnerable",
      score: 0.95,
      publishedDate: "2024-01-01",
    });
  });

  it("excludes raw content when not requested", async () => {
    mockResponse([{ title: "x", url: "https://u.example", content: "c", score: 0.5 }]);
    const searcher = createTavilySearcher("test-key");
    await searcher.search({ ...validInput, includeRawContent: false });
    const [, opts] = mockSearch.mock.calls[0];
    expect(opts.includeRawContent).toBe(false);
  });

  it("includes raw content as text when requested", async () => {
    mockResponse([{ title: "x", url: "https://u.example", content: "c", score: 0.5 }]);
    const searcher = createTavilySearcher("test-key");
    await searcher.search({ ...validInput, includeRawContent: true });
    const [, opts] = mockSearch.mock.calls[0];
    expect(opts.includeRawContent).toBe("text");
  });

  it("throws TavilyError when the SDK call fails", async () => {
    mockSearch.mockRejectedValue(new Error("network down"));
    const searcher = createTavilySearcher("test-key");
    await expect(searcher.search(validInput)).rejects.toThrow(TavilyError);
    await expect(searcher.search(validInput)).rejects.toThrow("network down");
  });

  it("throws TavilyError when API key is missing", async () => {
    const orig = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    try {
      const searcher = createTavilySearcher();
      await expect(searcher.search(validInput)).rejects.toThrow(TavilyError);
      await expect(searcher.search(validInput)).rejects.toThrow("TAVILY_API_KEY is not configured");
    } finally {
      process.env.TAVILY_API_KEY = orig;
    }
  });

  it("validates search input via Zod", async () => {
    const searcher = createTavilySearcher("test-key");
    await expect(searcher.search({ query: "" } as unknown as TavilySearchInput)).rejects.toThrow();
  });
});
