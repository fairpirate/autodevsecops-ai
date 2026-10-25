export * from "./crypto";
export * from "./client";
export * from "./api";
export * from "./webhooks";
export * from "./duo-flows";

import { GitLabClient } from "./client";
import { GitLabApi } from "./api";
import { DuoFlowsClient } from "./duo-flows";

export interface GitLabServiceOptions {
  baseUrl: string;
  token: string;
  duoFlowsEnabled?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Convenience factory wiring the REST API client + Duo Flows client. */
export function createGitLabService(opts: GitLabServiceOptions) {
  const client = new GitLabClient({
    baseUrl: opts.baseUrl,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
    sleep: opts.sleep,
  });
  return {
    client,
    api: new GitLabApi(client),
    duoFlows: new DuoFlowsClient(client, { enabled: opts.duoFlowsEnabled ?? false }),
  };
}
