import { z } from "zod";
import { tavily, type TavilyClient, type TavilySearchOptions } from "@tavily/core";

/* ------------------------------------------------------------------ *
 * Zod-validated request boundary (project convention)               *
 * ------------------------------------------------------------------ */

export const TavilySearchSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(10).default(5),
  includeAnswer: z.boolean().default(true),
  includeRawContent: z.boolean().default(false),
  searchDepth: z.enum(["basic", "advanced", "fast", "ultra-fast"]).default("basic"),
});

export type TavilySearchInput = z.infer<typeof TavilySearchSchema>;

/* ------------------------------------------------------------------ *
 * Domain types                                                       *
 * ------------------------------------------------------------------ */

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
}

export interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
}

export class TavilyError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "TavilyError";
  }
}

/* ------------------------------------------------------------------ *
 * Client interface + factory                                         *
 * ------------------------------------------------------------------ */

export interface TavilySearcher {
  search(input: TavilySearchInput): Promise<TavilySearchResponse>;
}

/**
 * Create a Tavily search client. Falls back to a throwing client when
 * `TAVILY_API_KEY` is not configured — callers must handle degradation
 * gracefully (security-review continues with deterministic findings only).
 */
export function createTavilySearcher(apiKey?: string): TavilySearcher {
  const key = apiKey ?? process.env.TAVILY_API_KEY;
  if (!key) {
    return {
      async search() {
        throw new TavilyError("TAVILY_API_KEY is not configured");
      },
    };
  }

  const client: TavilyClient = tavily({ apiKey });

  return {
    async search(input) {
      const params = TavilySearchSchema.parse(input);
      const options: TavilySearchOptions = {
        maxResults: params.maxResults,
        includeAnswer: params.includeAnswer,
        includeRawContent: params.includeRawContent ? "text" : false,
        searchDepth: params.searchDepth,
      };
      try {
        const res = await client.search(params.query, options);
        return {
          query: res.query,
          answer: typeof res.answer === "string" ? res.answer : undefined,
          results: res.results.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content,
            score: r.score,
            publishedDate: r.publishedDate ?? undefined,
          })),
        };
      } catch (error) {
        if (error instanceof TavilyError) throw error;
        const status = (error as { status?: number })?.status;
        throw new TavilyError(
          `Tavily search failed: ${error instanceof Error ? error.message : String(error)}`,
          status,
        );
      }
    },
  };
}
