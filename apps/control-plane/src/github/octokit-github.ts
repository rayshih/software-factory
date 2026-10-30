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
  commentHasExactMarker,
  isOurAppComment,
  issueCommentBody,
  keepCanonicalComment,
  type IssueComment,
} from "./issue-comment.js";
import { parseRepo } from "./repo.js";

type InstallationAuth = ReturnType<typeof createAppAuth>;
const issueCommentLocks = new Map<string, Promise<void>>();
const OPEN_PULL_PAGE_SIZE = 100;
const PULL_CREATE_RECONCILIATION_DELAYS_MS = [0, 100, 250, 500] as const;

interface TreeEntry {
  mode?: string;
  type?: string;
  sha?: string;
}

/**
 * The path already exists as something other than a regular file.
 * Rewriting it as a blob would change a symlink, directory, or submodule into a file.
 */
export class UnsupportedFileModeError extends Error {
  readonly path: string;
  readonly mode: string;

  constructor(path: string, mode: string) {
    super(`cannot update ${path}: existing tree entry mode ${mode} is not a regular file`);
    this.name = "UnsupportedFileModeError";
    this.path = path;
    this.mode = mode;
  }
}

/**
 * GitHub App client. Mints an installation token per call via @octokit/auth-app.
 * Does not merge pull requests.
 *
 * `installationClient` replaces the Octokit instance in tests.
 */
export class OctokitGitHub implements GitHubClient {
  private readonly auth: InstallationAuth;
  private readonly appId: number;

  constructor(
    appId: string,
    privateKey: string,
    private readonly installationClient?: (installationId: number) => Promise<Octokit>,
  ) {
    const parsed = Number(appId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`invalid GitHub app id: ${appId}`);
    }
    this.appId = parsed;
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
    if (await this.branchHasContentHash(octokit, owner, repo, input.branch, parentSha, hash)) {
      return { sha: parentSha, created: false };
    }
    const parent = await octokit.rest.git.getCommit({ owner, repo, commit_sha: parentSha });
    const treeCache = new Map<string, Map<string, TreeEntry>>();
    const treeEntries = [];
    for (const file of input.files) {
      treeEntries.push({
        path: file.path,
        mode: await this.regularFileMode(
          octokit,
          owner,
          repo,
          parent.data.tree.sha,
          file.path,
          treeCache,
        ),
        type: "blob" as const,
        content: file.content,
      });
    }
    const tree = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: parent.data.tree.sha,
      tree: treeEntries,
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
        force: false,
      });
      return { sha: commit.data.sha, created: true };
    } catch (error) {
      if (isHttpStatus(error, 422) || isHttpStatus(error, 409)) {
        const head = await this.readRef(octokit, owner, repo, input.branch);
        if (
          head &&
          (await this.branchHasContentHash(octokit, owner, repo, input.branch, head, hash))
        ) {
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
      if (shouldReconcilePullCreate(error)) {
        const raced = isAmbiguousPullCreateFailure(error)
          ? await this.reconcileAmbiguousPullCreate(
              octokit,
              owner,
              repo,
              input.headBranch,
              input.baseBranch,
            )
          : await this.findOpenPull(
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
      const listPage = (page: number) =>
        this.listIssueComments(octokit, owner, repo, input.issueNumber, page);
      const deleteComment = async (id: number) => {
        try {
          await octokit.rest.issues.deleteComment({ owner, repo, comment_id: id });
        } catch (error) {
          if (!isHttpStatus(error, 404)) throw error;
        }
      };
      const ownedIds = async () => this.ownedCommentIds(input.marker, listPage);
      const existing = await ownedIds();
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
      const after = await ownedIds();
      const ids = after.includes(created.data.id) ? after : [...after, created.data.id];
      const id = await keepCanonicalComment(ids, deleteComment);
      return { id, created: id === created.data.id };
    });
  }

  private async listIssueComments(
    octokit: Octokit,
    owner: string,
    repo: string,
    issueNumber: number,
    page: number,
  ): Promise<IssueComment[]> {
    const comments = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
      page,
    });
    return comments.data;
  }

  private async ownedCommentIds(
    marker: string,
    listPage: (page: number) => Promise<readonly IssueComment[]>,
  ): Promise<number[]> {
    const ids: number[] = [];
    for (let page = 1; ; page += 1) {
      const comments = await listPage(page);
      for (const comment of comments) {
        if (isOurAppComment(comment, this.appId) && commentHasExactMarker(comment.body, marker)) {
          ids.push(comment.id);
        }
      }
      if (comments.length < 100) return ids;
    }
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

  private async reconcileAmbiguousPullCreate(
    octokit: Octokit,
    owner: string,
    repo: string,
    headBranch: string,
    baseBranch: string,
  ): Promise<{ number: number; url: string } | null> {
    for (const delayMs of PULL_CREATE_RECONCILIATION_DELAYS_MS) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        const pull = await this.findOpenPull(octokit, owner, repo, headBranch, baseBranch);
        if (pull) return pull;
      } catch {
        // Keep reconciling until the bounded window expires, then preserve the create error.
      }
    }
    return null;
  }

  private async listTree(
    octokit: Octokit,
    owner: string,
    repo: string,
    treeSha: string,
    cache: Map<string, Map<string, TreeEntry>>,
  ): Promise<Map<string, TreeEntry>> {
    const cached = cache.get(treeSha);
    if (cached) return cached;
    const response = await octokit.rest.git.getTree({ owner, repo, tree_sha: treeSha });
    if (response.data.truncated) {
      throw new Error(`tree ${treeSha} listing was truncated, so file modes cannot be preserved`);
    }
    const entries = new Map<string, TreeEntry>();
    for (const entry of response.data.tree) {
      if (!entry.path) continue;
      entries.set(entry.path, { mode: entry.mode, type: entry.type, sha: entry.sha });
    }
    cache.set(treeSha, entries);
    return entries;
  }

  /**
   * Existing regular files keep their mode. A missing path is a new file and uses 100644.
   * Symlinks, directories, and submodules are rejected instead of being rewritten as blobs.
   */
  private async regularFileMode(
    octokit: Octokit,
    owner: string,
    repo: string,
    rootTreeSha: string,
    path: string,
    cache: Map<string, Map<string, TreeEntry>>,
  ): Promise<"100644" | "100755"> {
    const parts = path.split("/");
    let treeSha = rootTreeSha;
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      if (!name) throw new UnsupportedFileModeError(path, "unknown");
      const listing = await this.listTree(octokit, owner, repo, treeSha, cache);
      const entry = listing.get(name);
      if (!entry) return "100644";
      const last = index === parts.length - 1;
      if (last) {
        if (entry.mode === "100644" || entry.mode === "100755") return entry.mode;
        throw new UnsupportedFileModeError(path, entry.mode ?? "unknown");
      }
      if (entry.type !== "tree" || !entry.sha) {
        throw new UnsupportedFileModeError(path, entry.mode ?? "unknown");
      }
      treeSha = entry.sha;
    }
    return "100644";
  }

  private async branchHasContentHash(
    octokit: Octokit,
    owner: string,
    repo: string,
    branch: string,
    headSha: string,
    hash: string,
  ): Promise<boolean> {
    return findContentHashInHistory(branch, headSha, hash, async (page, pinnedSha) => {
      const commits = await octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: pinnedSha,
        per_page: COMMIT_HISTORY_PAGE_SIZE,
        page,
      });
      return commits.data.map((commit) => ({ message: commit.commit.message }));
    });
  }
}

/** 422/409 means the pull may already exist. A timeout may mean create succeeded and the response was lost. */
export function shouldReconcilePullCreate(error: unknown): boolean {
  if (isHttpStatus(error, 422) || isHttpStatus(error, 409)) return true;
  return isAmbiguousPullCreateFailure(error);
}

function isAmbiguousPullCreateFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("name" in error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return true;
  return (
    "code" in error &&
    (error.code === "ETIMEDOUT" || error.code === "ECONNRESET" || error.code === "ECONNABORTED")
  );
}

export function createOctokitGitHub(config: { appId: string; privateKey: string }): GitHubClient {
  return new OctokitGitHub(config.appId, config.privateKey);
}
