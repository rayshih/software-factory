import type { FileChange } from "./content-hash.js";

export interface BranchRef {
  sha: string;
  created: boolean;
}

export interface PushResult {
  sha: string;
  created: boolean;
}

export interface BranchComparison {
  aheadBy: number;
  behindBy: number;
  status: "ahead" | "behind" | "identical" | "diverged";
}

export interface PullRequestRef {
  number: number;
  url: string;
  created: boolean;
}

export interface IssueCommentResult {
  id: number;
  created: boolean;
}

/**
 * GitHub operations the factory is allowed to perform.
 * There is no merge method. A human merges outside this process.
 * Every method is safe to call again with the same inputs.
 */
export interface GitHubClient {
  getInstallationToken(installationId: number): Promise<string>;

  ensureBranch(input: {
    installationId: number;
    repo: string;
    branch: string;
    baseBranch: string;
  }): Promise<BranchRef>;

  pushFiles(input: {
    installationId: number;
    repo: string;
    branch: string;
    issueNumber: number;
    files: readonly FileChange[];
  }): Promise<PushResult>;

  compare(input: {
    installationId: number;
    repo: string;
    base: string;
    head: string;
  }): Promise<BranchComparison>;

  openPullRequest(input: {
    installationId: number;
    repo: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<PullRequestRef>;

  commentOnIssue(input: {
    installationId: number;
    repo: string;
    issueNumber: number;
    body: string;
    marker: string;
  }): Promise<IssueCommentResult>;
}
