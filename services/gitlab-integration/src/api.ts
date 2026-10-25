import type { GitLabClient } from "./client";

export interface GitLabProjectInfo {
  id: number;
  path_with_namespace: string;
  name: string;
  default_branch: string;
  web_url: string;
  visibility?: string;
}

export interface GitLabCommitInfo {
  id: string;
  short_id: string;
  title: string;
  author_name: string;
  created_at: string;
  parent_ids: string[];
}

export interface GitLabBranchInfo {
  name: string;
  commit: { id: string; title: string };
  default: boolean;
}

export interface GitLabMergeRequestInfo {
  iid: number;
  title: string;
  state: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  sha: string;
}

export interface GitLabPipelineInfo {
  id: number;
  status: string;
  ref: string;
  sha: string;
  web_url: string;
}

/** High-level GitLab operations used by the platform. */
export class GitLabApi {
  constructor(private readonly client: GitLabClient) {}

  validateAccess(): Promise<void> {
    return this.me().then(() => undefined);
  }

  me(): Promise<{ username: string; id: number }> {
    return this.client.request("GET", "/api/v4/user").then((r) => r.data as { username: string; id: number });
  }

  async findProject(idOrPath: number | string): Promise<GitLabProjectInfo> {
    const path =
      typeof idOrPath === "number"
        ? `/api/v4/projects/${idOrPath}`
        : `/api/v4/projects/${encodeURIComponent(idOrPath)}`;
    const { data } = await this.client.request<GitLabProjectInfo>("GET", path);
    return data;
  }

  listBranches(idOrPath: number | string): Promise<GitLabBranchInfo[]> {
    return this.client.paginateAll<GitLabBranchInfo>(`/api/v4/projects/${idOrPath}/repository/branches`);
  }

  listCommits(idOrPath: number | string, refName?: string): Promise<GitLabCommitInfo[]> {
    return this.client.paginateAll<GitLabCommitInfo>(`/api/v4/projects/${idOrPath}/repository/commits`, {
      ref_name: refName,
    });
  }

  async getCommit(idOrPath: number | string, sha: string): Promise<GitLabCommitInfo> {
    const { data } = await this.client.request<GitLabCommitInfo>(
      "GET",
      `/api/v4/projects/${idOrPath}/repository/commits/${sha}`,
    );
    return data;
  }

  async getCommitDiff(
    idOrPath: number | string,
    sha: string,
  ): Promise<Array<{ new_path: string; diff: string; new_file: boolean; deleted_file: boolean }>> {
    const { data } = await this.client.request<Array<{ new_path: string; diff: string; new_file: boolean; deleted_file: boolean }>>(
      "GET",
      `/api/v4/projects/${idOrPath}/repository/commits/${sha}/diff`,
    );
    return data;
  }

  getFile(idOrPath: number | string, filePath: string, ref: string): Promise<{ content: string; encoding: string }> {
    return this.client
      .request("GET", `/api/v4/projects/${idOrPath}/repository/files/${encodeURIComponent(filePath)}`, {
        query: { ref },
      })
      .then((r) => r.data as { content: string; encoding: string });
  }

  listMergeRequests(idOrPath: number | string, state?: string): Promise<GitLabMergeRequestInfo[]> {
    return this.client.paginateAll<GitLabMergeRequestInfo>(`/api/v4/projects/${idOrPath}/merge_requests`, {
      state,
    });
  }

  listPipelines(idOrPath: number | string, ref?: string): Promise<GitLabPipelineInfo[]> {
    return this.client.paginateAll<GitLabPipelineInfo>(`/api/v4/projects/${idOrPath}/pipelines`, { ref });
  }

  async getPipelineJobs(idOrPath: number | string, pipelineId: number): Promise<
    Array<{ id: number; name: string; stage: string; status: string; web_url: string }>
  > {
    const { data } = await this.client.request<Array<{ id: number; name: string; stage: string; status: string; web_url: string }>>(
      "GET",
      `/api/v4/projects/${idOrPath}/pipelines/${pipelineId}/jobs`,
    );
    return data;
  }

  async getJobLog(idOrPath: number | string, jobId: number): Promise<string> {
    const { data } = await this.client.request<string>("GET", `/api/v4/projects/${idOrPath}/jobs/${jobId}/trace`, {
      raw: true,
    });
    return data;
  }

  async createBranch(idOrPath: number | string, branch: string, ref: string): Promise<void> {
    await this.client.request("POST", `/api/v4/projects/${idOrPath}/repository/branches`, {
      body: { branch, ref },
    });
  }

  async commitFiles(
    idOrPath: number | string,
    branch: string,
    message: string,
    actions: Array<{ action: "create" | "update" | "delete"; file_path: string; content?: string }>,
  ): Promise<{ id: string }> {
    const { data } = await this.client.request<{ id: string }>(
      "POST",
      `/api/v4/projects/${idOrPath}/repository/commits`,
      { body: { branch, commit_message: message, actions } },
    );
    return data;
  }

  async createMergeRequest(
    idOrPath: number | string,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description: string,
  ): Promise<GitLabMergeRequestInfo> {
    const { data } = await this.client.request<GitLabMergeRequestInfo>(
      "POST",
      `/api/v4/projects/${idOrPath}/merge_requests`,
      {
        body: { source_branch: sourceBranch, target_branch: targetBranch, title, description, remove_source_branch: true },
      },
    );
    return data;
  }

  async createNote(idOrPath: number | string, mrIid: number, body: string): Promise<void> {
    await this.client.request("POST", `/api/v4/projects/${idOrPath}/merge_requests/${mrIid}/notes`, {
      body: { body },
    });
  }
}
