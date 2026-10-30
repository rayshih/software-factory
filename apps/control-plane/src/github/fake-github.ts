import { operationHash, type FileChange } from "./content-hash.js";
import { SENSITIVE_PATH_LABEL, checkPush, sensitivePullNote } from "./push-guard.js";
import type {
  BranchComparison,
  GitHubClient,
  IssueCommentResult,
  PullRequestRef,
  PushResult,
} from "./client.js";
import { commentHasExactMarker, issueCommentBody } from "./issue-comment.js";

interface CommitState {
  sha: string;
  parentSha: string | null;
  message: string;
  contentHashes: Set<string>;
}

interface BranchState {
  sha: string;
}

interface PullState {
  number: number;
  url: string;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  state: "open" | "closed";
  merged: boolean;
  labels: string[];
}

interface CommentState {
  id: number;
  issueNumber: number;
  body: string;
  appOwned: boolean;
}

interface RepoState {
  defaultBranch: string;
  baseSha: string;
  commits: Map<string, CommitState>;
  branches: Map<string, BranchState>;
  pulls: PullState[];
  comments: CommentState[];
  nextPr: number;
  nextComment: number;
  nextCommit: number;
}

/**
 * In-memory GitHub App installation. Used by tests so CI does not need credentials.
 * Counts real creates separately from idempotent repeats.
 */
export class FakeGitHub implements GitHubClient {
  readonly pullsCreated: PullState[] = [];
  readonly commentsCreated: CommentState[] = [];
  openPullRequestCalls = 0;
  pushCalls = 0;
  pushesCreated = 0;

  private readonly repos = new Map<string, RepoState>();
  private readonly tokens = new Map<number, string>();

  constructor() {
    this.tokens.set(1, "ghs_fake");
  }

  seedToken(installationId: number, token = `ghs_fake_${installationId}`): void {
    this.tokens.set(installationId, token);
  }

  seedRepo(fullName: string, options?: { defaultBranch?: string; baseSha?: string }): void {
    const defaultBranch = options?.defaultBranch ?? "main";
    const baseSha = options?.baseSha ?? "base-sha";
    this.repos.set(fullName, {
      defaultBranch,
      baseSha,
      commits: new Map([
        [baseSha, { sha: baseSha, parentSha: null, message: "init", contentHashes: new Set() }],
      ]),
      branches: new Map([[defaultBranch, { sha: baseSha }]]),
      pulls: [],
      comments: [],
      nextPr: 1,
      nextComment: 1,
      nextCommit: 1,
    });
  }

  seedOpenPullRequest(fullName: string, headBranch: string, baseBranch = "main"): PullState {
    const repo = this.repo(fullName);
    const branch = repo.branches.get(headBranch);
    if (!branch || branch.sha === repo.baseSha) {
      const base = repo.branches.get(baseBranch);
      const parentSha = base?.sha ?? repo.baseSha;
      const sha = `seed-${headBranch}`;
      repo.commits.set(sha, {
        sha,
        parentSha,
        message: "seeded ahead",
        contentHashes: new Set(),
      });
      repo.branches.set(headBranch, { sha });
    }
    const number = repo.nextPr++;
    const pull: PullState = {
      number,
      url: `https://github.com/${fullName}/pull/${number}`,
      headBranch,
      baseBranch,
      title: "existing",
      body: "existing",
      labels: [],
      state: "open",
      merged: false,
    };
    repo.pulls.push(pull);
    return pull;
  }

  openPulls(fullName: string): readonly PullState[] {
    return this.repo(fullName).pulls.filter((pull) => pull.state === "open");
  }

  seedIssueComment(
    fullName: string,
    issueNumber: number,
    body: string,
    options?: { appOwned?: boolean },
  ): number {
    const repo = this.repo(fullName);
    const id = repo.nextComment++;
    repo.comments.push({ id, issueNumber, body, appOwned: options?.appOwned ?? false });
    return id;
  }

  async getInstallationToken(installationId: number): Promise<string> {
    return this.tokens.get(installationId) ?? `ghs_fake_${installationId}`;
  }

  async ensureBranch(input: {
    installationId: number;
    repo: string;
    branch: string;
    baseBranch: string;
  }): Promise<{ sha: string; created: boolean }> {
    const repo = this.repo(input.repo);
    const existing = repo.branches.get(input.branch);
    if (existing) return { sha: existing.sha, created: false };
    const base = repo.branches.get(input.baseBranch);
    if (!base) throw new Error(`base branch ${input.baseBranch} does not exist`);
    repo.branches.set(input.branch, { sha: base.sha });
    return { sha: base.sha, created: true };
  }

  async pushFiles(input: {
    installationId: number;
    repo: string;
    branch: string;
    issueNumber: number;
    files: readonly FileChange[];
    allowedRepos?: ReadonlySet<string>;
    limits?: { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number };
  }): Promise<PushResult> {
    const guard = checkPush({
      repo: input.repo,
      branch: input.branch,
      files: input.files,
      allowedRepos: input.allowedRepos,
      limits: input.limits,
    });
    this.pushCalls += 1;
    const repo = this.repo(input.repo);
    const branch = repo.branches.get(input.branch);
    if (!branch) throw new Error(`branch ${input.branch} does not exist`);
    const hash = operationHash(input.branch, input.issueNumber, input.files);
    if (this.historyHasHash(repo, branch.sha, hash)) {
      return {
        sha: branch.sha,
        created: false,
        ...(guard.sensitivePaths.length > 0 ? { sensitivePaths: guard.sensitivePaths } : {}),
      };
    }
    const sha = `commit-${repo.nextCommit++}`;
    repo.commits.set(sha, {
      sha,
      parentSha: branch.sha,
      message: `Apply changes for issue #${input.issueNumber}\n\nFactory-Content-Hash: ${hash}\n`,
      contentHashes: new Set([hash]),
    });
    branch.sha = sha;
    this.pushesCreated += 1;
    return {
      sha,
      created: true,
      ...(guard.sensitivePaths.length > 0 ? { sensitivePaths: guard.sensitivePaths } : {}),
    };
  }

  async compare(input: {
    installationId: number;
    repo: string;
    base: string;
    head: string;
  }): Promise<BranchComparison> {
    const repo = this.repo(input.repo);
    const head = repo.branches.get(input.head);
    const base = repo.branches.get(input.base);
    if (!head || !base) throw new Error("branch not found");
    const headChain = this.ancestry(repo, head.sha);
    const baseChain = this.ancestry(repo, base.sha);
    const baseShas = new Set(baseChain);
    const mergeBaseIndex = headChain.findIndex((sha) => baseShas.has(sha));
    if (mergeBaseIndex < 0) throw new Error("no common ancestor");
    const mergeBase = headChain[mergeBaseIndex];
    if (!mergeBase) throw new Error("no common ancestor");
    const aheadBy = mergeBaseIndex;
    const behindBy = baseChain.indexOf(mergeBase);
    const status =
      aheadBy === 0 && behindBy === 0
        ? "identical"
        : aheadBy > 0 && behindBy === 0
          ? "ahead"
          : aheadBy === 0 && behindBy > 0
            ? "behind"
            : "diverged";
    return { aheadBy, behindBy, status };
  }

  async openPullRequest(input: {
    installationId: number;
    repo: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
    sensitivePaths?: readonly string[];
  }): Promise<PullRequestRef> {
    this.openPullRequestCalls += 1;
    const repo = this.repo(input.repo);
    const existing = repo.pulls.find(
      (pull) =>
        pull.state === "open" &&
        pull.headBranch === input.headBranch &&
        pull.baseBranch === input.baseBranch,
    );
    const body = withSensitiveNote(input.body, input.sensitivePaths);
    if (existing) {
      addSensitiveLabel(existing, input.sensitivePaths);
      if (input.sensitivePaths && input.sensitivePaths.length > 0 && body !== existing.body) {
        existing.body = body;
      }
      return { number: existing.number, url: existing.url, created: false };
    }
    const comparison = await this.compare({
      installationId: input.installationId,
      repo: input.repo,
      base: input.baseBranch,
      head: input.headBranch,
    });
    if (comparison.aheadBy < 1) {
      throw new Error("No commits between the base and head branches");
    }
    const number = repo.nextPr++;
    const pull: PullState = {
      number,
      url: `https://github.com/${input.repo}/pull/${number}`,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
      title: input.title,
      body,
      labels: [],
      state: "open",
      merged: false,
    };
    addSensitiveLabel(pull, input.sensitivePaths);
    repo.pulls.push(pull);
    this.pullsCreated.push(pull);
    return { number, url: pull.url, created: true };
  }

  async commentOnIssue(input: {
    installationId: number;
    repo: string;
    issueNumber: number;
    body: string;
    marker: string;
  }): Promise<IssueCommentResult> {
    const repo = this.repo(input.repo);
    const existing = repo.comments.find(
      (comment) =>
        comment.issueNumber === input.issueNumber &&
        comment.appOwned &&
        commentHasExactMarker(comment.body, input.marker),
    );
    if (existing) return { id: existing.id, created: false };
    const comment: CommentState = {
      id: repo.nextComment++,
      issueNumber: input.issueNumber,
      body: issueCommentBody(input.body, input.marker),
      appOwned: true,
    };
    repo.comments.push(comment);
    this.commentsCreated.push(comment);
    return { id: comment.id, created: true };
  }

  private repo(fullName: string): RepoState {
    const repo = this.repos.get(fullName);
    if (!repo) throw new Error(`fake repo ${fullName} was not seeded`);
    return repo;
  }

  private ancestry(repo: RepoState, sha: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | null = sha;
    while (current && !seen.has(current)) {
      const commit = repo.commits.get(current);
      if (!commit) break;
      seen.add(current);
      chain.push(current);
      current = commit.parentSha;
    }
    return chain;
  }

  private historyHasHash(repo: RepoState, sha: string, hash: string): boolean {
    return this.ancestry(repo, sha).some(
      (commitSha) => repo.commits.get(commitSha)?.contentHashes.has(hash) ?? false,
    );
  }
}

function withSensitiveNote(body: string, paths: readonly string[] | undefined): string {
  if (!paths || paths.length === 0) return body;
  const note = sensitivePullNote(paths);
  return body.includes(note) ? body : `${body}\n\n${note}`;
}

function addSensitiveLabel(pull: PullState, paths: readonly string[] | undefined): void {
  if (!paths || paths.length === 0) return;
  if (!pull.labels.includes(SENSITIVE_PATH_LABEL)) pull.labels.push(SENSITIVE_PATH_LABEL);
}
