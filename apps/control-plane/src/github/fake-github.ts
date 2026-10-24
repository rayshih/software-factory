import { contentHash, type FileChange } from "./content-hash.js";
import type {
  BranchComparison,
  GitHubClient,
  IssueCommentResult,
  PullRequestRef,
  PushResult,
} from "./client.js";

interface BranchState {
  sha: string;
  message: string;
  commits: number;
  contentHashes: Set<string>;
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
}

interface CommentState {
  id: number;
  issueNumber: number;
  body: string;
}

interface RepoState {
  defaultBranch: string;
  baseSha: string;
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
      branches: new Map([
        [defaultBranch, { sha: baseSha, message: "init", commits: 0, contentHashes: new Set() }],
      ]),
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
      repo.branches.set(headBranch, {
        sha: `seed-${headBranch}`,
        message: "seeded ahead",
        commits: 1,
        contentHashes: new Set(),
      });
    }
    const number = repo.nextPr++;
    const pull: PullState = {
      number,
      url: `https://github.com/${fullName}/pull/${number}`,
      headBranch,
      baseBranch,
      title: "existing",
      body: "existing",
      state: "open",
      merged: false,
    };
    repo.pulls.push(pull);
    return pull;
  }

  openPulls(fullName: string): readonly PullState[] {
    return this.repo(fullName).pulls.filter((pull) => pull.state === "open");
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
    repo.branches.set(input.branch, {
      sha: base.sha,
      message: base.message,
      commits: 0,
      contentHashes: new Set(base.contentHashes),
    });
    return { sha: base.sha, created: true };
  }

  async pushFiles(input: {
    installationId: number;
    repo: string;
    branch: string;
    issueNumber: number;
    files: readonly FileChange[];
  }): Promise<PushResult> {
    this.pushCalls += 1;
    const repo = this.repo(input.repo);
    const branch = repo.branches.get(input.branch);
    if (!branch) throw new Error(`branch ${input.branch} does not exist`);
    const hash = contentHash(input.files);
    if (branch.contentHashes.has(hash)) {
      return { sha: branch.sha, created: false };
    }
    const sha = `commit-${repo.nextCommit++}`;
    branch.sha = sha;
    branch.message = `Apply changes for issue #${input.issueNumber}\n\nFactory-Content-Hash: ${hash}\n`;
    branch.commits += 1;
    branch.contentHashes.add(hash);
    this.pushesCreated += 1;
    return { sha, created: true };
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
    if (head.sha === base.sha || head.commits === 0) {
      return { aheadBy: 0, behindBy: 0, status: "identical" };
    }
    return { aheadBy: head.commits, behindBy: 0, status: "ahead" };
  }

  async openPullRequest(input: {
    installationId: number;
    repo: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<PullRequestRef> {
    this.openPullRequestCalls += 1;
    const repo = this.repo(input.repo);
    const existing = repo.pulls.find(
      (pull) =>
        pull.state === "open" &&
        pull.headBranch === input.headBranch &&
        pull.baseBranch === input.baseBranch,
    );
    if (existing) {
      existing.title = input.title;
      existing.body = input.body;
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
      body: input.body,
      state: "open",
      merged: false,
    };
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
      (comment) => comment.issueNumber === input.issueNumber && comment.body.includes(input.marker),
    );
    if (existing) return { id: existing.id, created: false };
    const comment: CommentState = {
      id: repo.nextComment++,
      issueNumber: input.issueNumber,
      body: input.body,
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
}
