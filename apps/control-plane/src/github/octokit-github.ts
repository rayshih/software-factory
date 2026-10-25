import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { commitMessage, operationHash, type FileChange } from "./content-hash.js";
import type {
  BranchComparison,
  BranchRef,
  GitHubClient,
  IssueCommentResult,
  PullRequestRef,
  PushResult,
} from "./client.js";
import { COMMIT_HISTORY_PAGE_SIZE, findContentHashInHistory } from "./commit-history.js";
import { isHttpStatus } from "./errors.js";
import {
  issueCommentBody,
  keepCanonicalComment,
  listIssueCommentIdsByMarker,
} from "./issue-comment.js";
import { parseRepo } from "./repo.js";

type InstallationAuth = ReturnType<typeof createAppAuth>;
const issueCommentLocks = new Map<string, Promise<void>>();
const OPEN_PULL_PAGE_SIZE = 100;

/**
 * GitHub App client. Mints an installation token per call via @octokit/auth-app.
 * Does not merge pull requests.
 *
 * `installationClient` replaces the Octokit instance in tests.
 */
export class OctokitGitHub implements GitHubClient {
  private readonly auth: InstallationAuth;

  constructor(
    appId: string,
    privateKey: string,
    private readonly installationClient?: (installationId: number) => Promise<Octokit>,
  ) {
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
    const hash = operationHash(input.branch, input.issueNumber, input.files);
    if (await this.branchHasContentHash(octokit, owner, repo, input.branch, hash)) {
      return { sha: parentSha, created: false };
    }
    const parent = await octokit.rest.git.getCommit({ owner, repo, commit_sha: parentSha });
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
      const listPage = async (page: number) => {
        const comments = await octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: input.issueNumber,
          per_page: 100,
          page,
        });
        return comments.data;
      };
      const deleteComment = async (id: number) => {
        try {
          await octokit.rest.issues.deleteComment({ owner, repo, comment_id: id });
        } catch (error) {
          if (!isHttpStatus(error, 404)) throw error;
        }
      };
      const existing = await listIssueCommentIdsByMarker(input.marker, listPage);
      if (existing.length > 0) {
        const id = await keepCanonicalComment(existing, deleteComment);
        return { id, created: false };
      }
      const created = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: input.issueNumber,
        body: issueCommentBody(input.body, input.marker),
      });
      const after = await listIssueCommentIdsByMarker(input.marker, listPage);
      const ids = after.includes(created.data.id) ? after : [...after, created.data.id];
      const id = await keepCanonicalComment(ids, deleteComment);
      return { id, created: id === created.data.id };
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
    if (this.installationClient) return this.installationClient(installationId);
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
    const fullName = `${owner}/${repo}`.toLowerCase();
    for (let page = 1; ; page += 1) {
      const response = await octokit.rest.pulls.list({
        owner,
        repo,
        state: "open",
        head: `${owner}:${headBranch}`,
        base: baseBranch,
        per_page: OPEN_PULL_PAGE_SIZE,
        page,
      });
      const match = response.data.find(
        (pull) =>
          pull.head.ref === headBranch &&
          pull.head.repo?.full_name.toLowerCase() === fullName &&
          pull.base.ref === baseBranch,
      );
      if (match) return { number: match.number, url: match.html_url };
      if (response.data.length < OPEN_PULL_PAGE_SIZE) return null;
    }
  }

  private async branchHasContentHash(
    octokit: Octokit,
    owner: string,
    repo: string,
    branch: string,
    hash: string,
  ): Promise<boolean> {
    return findContentHashInHistory(branch, hash, async (page) => {
      const commits = await octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: branch,
        per_page: COMMIT_HISTORY_PAGE_SIZE,
        page,
      });
      return commits.data.map((commit) => ({ message: commit.commit.message }));
    });
  }
}

export function createOctokitGitHub(config: { appId: string; privateKey: string }): GitHubClient {
  return new OctokitGitHub(config.appId, config.privateKey);
}
