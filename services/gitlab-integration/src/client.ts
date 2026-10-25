import { redactToken } from "./crypto";

export interface GitLabClientOptions {
  baseUrl: string;
  token: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Sleep function for tests. */
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  now?: () => number;
}

export class GitLabApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
    public readonly body?: string,
  ) {
    super(redactToken(message));
    this.name = "GitLabApiError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * GitLab REST client with:
 * - rate-limit handling (X-RateLimit-* / 429 Retry-After, exponential backoff)
 * - pagination helpers (page/per_page, x-next-page or Link header)
 * - retries on 5xx/network errors
 * - token never logged
 */
export class GitLabClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(opts: GitLabClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxRetries = opts.maxRetries ?? 4;
  }

  async request<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; query?: Record<string, string | number | undefined>; raw?: boolean },
  ): Promise<{ data: T; headers: Headers }> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts?.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          "PRIVATE-TOKEN": this.token,
          ...(opts?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "0");
        const reset = Number(res.headers.get("x-ratelimit-reset") ?? "0");
        const nowSec = Math.floor(Date.now() / 1000);
        const waitSec = retryAfter > 0 ? retryAfter : reset > nowSec ? reset - nowSec + 1 : 2 ** attempt;
        if (attempt >= this.maxRetries) {
          throw new GitLabApiError(`Rate limited after ${attempt} retries: ${path}`, res.status, path);
        }
        await this.sleep(Math.min(waitSec, 60) * 1000);
        attempt++;
        continue;
      }

      if (res.status >= 500) {
        if (attempt >= this.maxRetries) {
          throw new GitLabApiError(`Server error ${res.status} for ${path}`, res.status, path);
        }
        await this.sleep(2 ** attempt * 500);
        attempt++;
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new GitLabApiError(
          `GitLab ${method} ${path} failed: ${res.status} ${body.slice(0, 300)}`,
          res.status,
          path,
          body,
        );
      }

      if (opts?.raw) {
        return { data: (await res.text()) as unknown as T, headers: res.headers };
      }
      const text = await res.text();
      return { data: (text ? JSON.parse(text) : undefined) as T, headers: res.headers };
    }
  }

  /**
   * Iterate all pages of a paginated collection (100 per page).
   * Uses `x-next-page` when present, otherwise stops when a short page returns.
   */
  async *paginate<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
    maxPages = 50,
  ): AsyncGenerator<T> {
    let page = Number(query.page ?? 1);
    for (let i = 0; i < maxPages; i++) {
      const { data, headers } = await this.request<T[]>("GET", path, {
        query: { ...query, page, per_page: 100 },
      });
      for (const item of data) yield item;
      const nextPage = headers.get("x-next-page");
      if (nextPage) {
        page = Number(nextPage);
        continue;
      }
      if (data.length < 100) return;
      page++;
    }
  }

  /** Collect all pages into an array. */
  async paginateAll<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
    maxPages = 50,
  ): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this.paginate<T>(path, query, maxPages)) out.push(item);
    return out;
  }

  /** First page with total count (for paginated API responses). */
  async page<T>(
    path: string,
    page: number,
    perPage: number,
    query: Record<string, string | number | undefined> = {},
  ): Promise<{ items: T[]; total: number }> {
    const { data, headers } = await this.request<T[]>("GET", path, {
      query: { ...query, page, per_page: perPage },
    });
    const total = Number(headers.get("x-total") ?? data.length);
    return { items: data, total };
  }
}
