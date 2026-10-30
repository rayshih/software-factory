import type { FileChange } from "./content-hash.js";

export interface BranchRef {
  sha: string;
  created: boolean;
}

export interface PushResult {
  sha: string;
  created: boolean;
  /** Paths a reviewer should notice; empty when the push has none. */
  sensitivePaths: readonly string[];
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
 * An existing pull request is returned as-is. Title and body stay whatever
 * a reviewer already wrote. Issue comments use an operation marker on its
 * own line, and only comments from this GitHub App are treated as ours.
 *
 * installationId and repo are supplied by the orchestrator from trusted
 * project configuration. The coding agent does not choose the repository.
 * That check belongs with the orchestrator integration. This client stays
 * the operations surface and does not grow an authorization framework.
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
    allowedRepos?: ReadonlySet<string>;
    limits?: { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number };
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
    /** Forward the value returned by pushFiles; do not reconstruct or discard it. */
    sensitivePaths: readonly string[];
  }): Promise<PullRequestRef>;

  commentOnIssue(input: {
    installationId: number;
    repo: string;
    issueNumber: number;
    body: string;
    marker: string;
  }): Promise<IssueCommentResult>;
}
