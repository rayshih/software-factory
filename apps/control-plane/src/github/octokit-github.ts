import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import {
  commitMessage,
  messageHasContentHash,
  operationHash,
  type FileChange,
} from "./content-hash.js";
import type {
  BranchComparison,
  BranchRef,
  GitHubClient,
  IssueCommentResult,
  PullRequestRef,
  PushResult,
} from "./client.js";
import { isHttpStatus } from "./errors.js";
import { findIssueCommentByMarker, issueCommentBody } from "./issue-comment.js";
import { parseRepo } from "./repo.js";

type InstallationAuth = ReturnType<typeof createAppAuth>;
const issueCommentLocks = new Map<string, Promise<void>>();

/**
 * GitHub App client. Mints an installation token per call via @octokit/auth-app.
 * Does not merge pull requests.
 */
export class OctokitGitHub implements GitHubClient {
  private readonly auth: InstallationAuth;

  constructor(appId: string, privateKey: string) {
    this.auth = createAppAuth({ appId, privateKey });
  }

  async getInstallationToken(installationId: number): Promise<string> {
    const authentication = await this.auth({ type: "installation", installationId });
    return authentication.token;
  }

  async ensureBranch(input: {
    installationId: number;
    repo: string;
    branch: string;
    baseBranch: string;
  }): Promise<BranchRef> {
    const octokit = await this.octokit(input.installationId);
    const { owner, repo } = parseRepo(input.repo);
    const existing = await this.readRef(octokit, owner, repo, input.branch);
    if (existing) return { sha: existing, created: false };
    const baseSha = await this.readRef(octokit, owner, repo, input.baseBranch);
    if (!baseSha)
      throw new Error(`base branch ${input.baseBranch} does not exist on ${input.repo}`);
    try {
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${input.branch}`,
        sha: baseSha,
      });
      return { sha: baseSha, created: true };
    } catch (error) {
      if (isHttpStatus(error, 422) || isHttpStatus(error, 409)) {
        const raced = await this.readRef(octokit, owner, repo, input.branch);
        if (raced) return { sha: raced, created: false };
      }
      throw error;
    }
  }

  async pushFiles(input: {
    installationId: number;
    repo: string;
    branch: string;
    issueNumber: number;
    files: readonly FileChange[];
  }): Promise<PushResult> {
    const octokit = await this.octokit(input.installationId);
    const { owner, repo } = parseRepo(input.repo);
    const parentSha = await this.readRef(octokit, owner, repo, input.branch);
    if (!parentSha) throw new Error(`branch ${input.branch} does not exist on ${input.repo}`);
    const hash = operationHash(input.issueNumber, input.files);
    const parent = await octokit.rest.git.getCommit({ owner, repo, commit_sha: parentSha });
    if (await this.branchHasContentHash(octokit, owner, repo, input.branch, hash)) {
      return { sha: parentSha, created: false };
    }
    const tree = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: parent.data.tree.sha,
      tree: input.files.map((file) => ({
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        content: file.content,
      })),
    });
    const commit = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: commitMessage(input.issueNumber, hash),
      tree: tree.data.sha,
      parents: [parentSha],
    });
    try {
      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${input.branch}`,
        sha: commit.data.sha,
      });
      return { sha: commit.data.sha, created: true };
    } catch (error) {
      if (isHttpStatus(error, 422) || isHttpStatus(error, 409)) {
        const head = await this.readRef(octokit, owner, repo, input.branch);
        if (head && (await this.branchHasContentHash(octokit, owner, repo, input.branch, hash))) {
          return { sha: head, created: false };
        }
      }
      throw error;
    }
  }

  async compare(input: {
    installationId: number;
    repo: string;
    base: string;
    head: string;
  }): Promise<BranchComparison> {
    const octokit = await this.octokit(input.installationId);
    const { owner, repo } = parseRepo(input.repo);
    const response = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${input.base}...${input.head}`,
    });
    const status = response.data.status;
    if (
      status !== "ahead" &&
      status !== "behind" &&
      status !== "identical" &&
      status !== "diverged"
    ) {
      throw new Error(`unexpected compare status ${status ?? "unknown"}`);
    }
    return {
      aheadBy: response.data.ahead_by,
      behindBy: response.data.behind_by,
      status,
    };
  }

  async openPullRequest(input: {
    installationId: number;
    repo: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<PullRequestRef> {
    const octokit = await this.octokit(input.installationId);
    const { owner, repo } = parseRepo(input.repo);
    const existing = await this.findOpenPull(
      octokit,
      owner,
      repo,
      input.headBranch,
      input.baseBranch,
    );
    if (existing) {
      await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: existing.number,
        title: input.title,
        body: input.body,
      });
      return { number: existing.number, url: existing.url, created: false };
    }
    try {
      const created = await octokit.rest.pulls.create({
        owner,
        repo,
        title: input.title,
        body: input.body,
        head: input.headBranch,
        base: input.baseBranch,
      });
      return { number: created.data.number, url: created.data.html_url, created: true };
    } catch (error) {
      if (isHttpStatus(error, 422) || isHttpStatus(error, 409)) {
        const raced = await this.findOpenPull(
          octokit,
          owner,
          repo,
          input.headBranch,
          input.baseBranch,
        );
        if (raced) return { number: raced.number, url: raced.url, created: false };
      }
      throw error;
    }
  }

  async commentOnIssue(input: {
    installationId: number;
    repo: string;
    issueNumber: number;
    body: string;
    marker: string;
  }): Promise<IssueCommentResult> {
    const lockKey = JSON.stringify([
      input.installationId,
      input.repo.toLowerCase(),
      input.issueNumber,
      input.marker,
    ]);
    return this.withIssueCommentLock(lockKey, async () => {
      const octokit = await this.octokit(input.installationId);
      const { owner, repo } = parseRepo(input.repo);
      const existingId = await findIssueCommentByMarker(input.marker, async (page) => {
        const comments = await octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: input.issueNumber,
          per_page: 100,
          page,
        });
        return comments.data;
      });
      if (existingId !== null) return { id: existingId, created: false };
      const created = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: input.issueNumber,
        body: issueCommentBody(input.body, input.marker),
      });
      return { id: created.data.id, created: true };
    });
  }

  private async withIssueCommentLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = issueCommentLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    issueCommentLocks.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (issueCommentLocks.get(key) === current) issueCommentLocks.delete(key);
    }
  }

  private async octokit(installationId: number): Promise<Octokit> {
    const token = await this.getInstallationToken(installationId);
    return new Octokit({ auth: token });
  }

  private async readRef(
    octokit: Octokit,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string | null> {
    try {
      const response = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      return response.data.object.sha;
    } catch (error) {
      if (isHttpStatus(error, 404)) return null;
      throw error;
    }
  }

  private async findOpenPull(
    octokit: Octokit,
    owner: string,
    repo: string,
    headBranch: string,
    baseBranch: string,
  ): Promise<{ number: number; url: string } | null> {
    const response = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "open",
      head: `${owner}:${headBranch}`,
      per_page: 20,
    });
    const fullName = `${owner}/${repo}`.toLowerCase();
    const match = response.data.find(
      (pull) =>
        pull.head.ref === headBranch &&
        pull.head.repo?.full_name.toLowerCase() === fullName &&
        pull.base.ref === baseBranch,
    );
    if (!match) return null;
    return { number: match.number, url: match.html_url };
  }

  private async branchHasContentHash(
    octokit: Octokit,
    owner: string,
    repo: string,
    branch: string,
    hash: string,
  ): Promise<boolean> {
    for (let page = 1; ; page += 1) {
      const commits = await octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: branch,
        per_page: 100,
        page,
      });
      if (commits.data.some((commit) => messageHasContentHash(commit.commit.message, hash))) {
        return true;
      }
      if (commits.data.length < 100) return false;
    }
  }
}

export function createOctokitGitHub(config: { appId: string; privateKey: string }): GitHubClient {
  return new OctokitGitHub(config.appId, config.privateKey);
}
