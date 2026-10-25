import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import { commitMessage, operationHash } from "../src/github/content-hash.js";
import { CommitHistoryLookupLimitError } from "../src/github/commit-history.js";
import { operationMarker } from "../src/github/issue-comment.js";
import { OctokitGitHub } from "../src/github/octokit-github.js";

const repo = "rayshih/sf-demo-todo-api";
const files = [{ path: "src/fix.ts", content: "export const fixed = true;\n" }];
const branch = "factory/issue-7";
const marker = operationMarker("pr-link");

function appComment(id: number, body: string, appId = 1) {
  return {
    id,
    body,
    user: { login: "forgeline-exp-bot[bot]", type: "Bot" },
    performed_via_github_app: { id: appId, slug: "forgeline-exp-bot" },
  };
}

function githubFor(rest: Record<string, unknown>): OctokitGitHub {
  return new OctokitGitHub("1", "unused", async () => ({ rest }) as unknown as Octokit);
}

function commitPages(messages: string[][]) {
  return vi.fn(async ({ page }: { page: number }) => ({
    data: (messages[page - 1] ?? []).map((message) => ({ commit: { message } })),
    headers: {},
  }));
}

describe("OctokitGitHub push history", () => {
  it("throws instead of committing when the history window is full and has no hash", async () => {
    const createCommit = vi.fn();
    const github = githubFor({
      git: {
        getRef: vi.fn(async () => ({ data: { object: { sha: "tip" } } })),
        createCommit,
      },
      repos: {
        listCommits: commitPages([
          Array.from({ length: 100 }, () => "unrelated"),
          Array.from({ length: 100 }, () => "still unrelated"),
        ]),
      },
    });

    await expect(
      github.pushFiles({ installationId: 1, repo, branch, issueNumber: 7, files }),
    ).rejects.toBeInstanceOf(CommitHistoryLookupLimitError);
    expect(createCommit).not.toHaveBeenCalled();
  });

  it("does not commit when an older page already contains the operation hash", async () => {
    const createCommit = vi.fn();
    const hash = operationHash(branch, 7, files);
    const github = githubFor({
      git: {
        getRef: vi.fn(async () => ({ data: { object: { sha: "tip" } } })),
        createCommit,
      },
      repos: {
        listCommits: commitPages([
          Array.from({ length: 100 }, () => "unrelated"),
          [commitMessage(7, hash)],
        ]),
      },
    });

    await expect(
      github.pushFiles({ installationId: 1, repo, branch, issueNumber: 7, files }),
    ).resolves.toEqual({ sha: "tip", created: false });
    expect(createCommit).not.toHaveBeenCalled();
  });

  it("commits when a short page shows the hash is absent", async () => {
    const github = githubFor({
      git: {
        getRef: vi.fn(async () => ({ data: { object: { sha: "tip" } } })),
        getCommit: vi.fn(async () => ({ data: { tree: { sha: "tree" } } })),
        createTree: vi.fn(async () => ({ data: { sha: "new-tree" } })),
        createCommit: vi.fn(async () => ({ data: { sha: "new-sha" } })),
        updateRef: vi.fn(async () => ({})),
      },
      repos: {
        listCommits: commitPages([Array.from({ length: 100 }, () => "unrelated"), ["init"]]),
      },
    });

    await expect(
      github.pushFiles({ installationId: 1, repo, branch, issueNumber: 7, files }),
    ).resolves.toEqual({ sha: "new-sha", created: true });
  });
});

describe("OctokitGitHub open pull lookup", () => {
  function pull(base: string, number: number) {
    return {
      number,
      html_url: `https://github.com/${repo}/pull/${number}`,
      head: { ref: branch, repo: { full_name: repo } },
      base: { ref: base },
    };
  }

  it("reuses a matching pull request past the first page and does not create another", async () => {
    const pullsCreate = vi.fn();
    const pullsUpdate = vi.fn(async () => ({}));
    const pullsList = vi.fn(async ({ page, base }: { page: number; base: string }) => {
      expect(base).toBe("release");
      if (page === 1) {
        return {
          data: Array.from({ length: 100 }, (_, index) => pull(`other-${index}`, index + 1)),
        };
      }
      return { data: [pull("release", 240)] };
    });
    const github = githubFor({
      pulls: { list: pullsList, create: pullsCreate, update: pullsUpdate },
    });

    await expect(
      github.openPullRequest({
        installationId: 1,
        repo,
        headBranch: branch,
        baseBranch: "release",
        title: "Fix",
        body: "body",
      }),
    ).resolves.toEqual({
      number: 240,
      url: `https://github.com/${repo}/pull/240`,
      created: false,
    });
    expect(pullsCreate).not.toHaveBeenCalled();
    expect(pullsUpdate).not.toHaveBeenCalled();
    expect(pullsList).toHaveBeenCalledTimes(2);
  });

  it("recovers a conflicting create by paginating to the existing pull request", async () => {
    const conflict = Object.assign(new Error("already exists"), { status: 422 });
    let created = false;
    const pullsList = vi.fn(async ({ page }: { page: number }) => {
      if (!created) return { data: [] };
      if (page === 1) {
        return {
          data: Array.from({ length: 100 }, (_, index) => pull(`other-${index}`, index + 1)),
        };
      }
      return { data: [pull("main", 9)] };
    });
    const github = githubFor({
      pulls: {
        list: pullsList,
        create: vi.fn(async () => {
          created = true;
          throw conflict;
        }),
        update: vi.fn(),
      },
    });

    await expect(
      github.openPullRequest({
        installationId: 1,
        repo,
        headBranch: branch,
        baseBranch: "main",
        title: "Fix",
        body: "body",
      }),
    ).resolves.toEqual({
      number: 9,
      url: `https://github.com/${repo}/pull/9`,
      created: false,
    });
  });
});

describe("OctokitGitHub issue comments", () => {
  it("collapses comments another worker created before this one finishes", async () => {
    const comments: { id: number; body: string | null }[] = [];
    const deleteComment = vi.fn(async ({ comment_id }: { comment_id: number }) => {
      const index = comments.findIndex((comment) => comment.id === comment_id);
      if (index < 0) {
        const missing = Object.assign(new Error("missing"), { status: 404 });
        throw missing;
      }
      comments.splice(index, 1);
    });
    const github = githubFor({
      issues: {
        listComments: vi.fn(async ({ page }: { page: number }) => ({
          data: page === 1 ? [...comments] : [],
        })),
        createComment: vi.fn(async ({ body }: { body: string }) => {
          comments.push(appComment(3, `earlier\n\n${marker}`), appComment(8, body));
          return { data: { id: 8 } };
        }),
        deleteComment,
      },
    });

    await expect(
      github.commentOnIssue({
        installationId: 1,
        repo,
        issueNumber: 7,
        marker,
        body: "Opened pull request #12",
      }),
    ).resolves.toEqual({ id: 3, created: false });
    expect(deleteComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 8 }));
    expect(comments.map((comment) => comment.id)).toEqual([3]);
  });

  it("deletes duplicate marker comments it finds before creating another", async () => {
    const comments = [appComment(4, `first\n\n${marker}`), appComment(9, `second\n\n${marker}`)];
    const createComment = vi.fn();
    const github = githubFor({
      issues: {
        listComments: vi.fn(async ({ page }: { page: number }) => ({
          data: page === 1 ? comments : [],
        })),
        createComment,
        deleteComment: vi.fn(async ({ comment_id }: { comment_id: number }) => {
          const index = comments.findIndex((comment) => comment.id === comment_id);
          if (index >= 0) comments.splice(index, 1);
        }),
      },
    });

    await expect(
      github.commentOnIssue({
        installationId: 1,
        repo,
        issueNumber: 7,
        marker,
        body: "Opened pull request #12",
      }),
    ).resolves.toEqual({ id: 4, created: false });
    expect(createComment).not.toHaveBeenCalled();
    expect(comments.map((comment) => comment.id)).toEqual([4]);
  });

  it("leaves a human comment that quotes the marker and still posts the app comment", async () => {
    const human = {
      id: 4,
      body: marker,
      user: { login: "ray", type: "User" },
      performed_via_github_app: null,
    };
    const otherBot = {
      id: 5,
      body: `copied\n${marker}`,
      user: { login: "other[bot]", type: "Bot" },
      performed_via_github_app: { id: 99, slug: "other" },
    };
    const comments = [human, otherBot];
    const deleteComment = vi.fn();
    const github = githubFor({
      issues: {
        listComments: vi.fn(async ({ page }: { page: number }) => ({
          data: page === 1 ? [...comments] : [],
        })),
        createComment: vi.fn(async ({ body }: { body: string }) => {
          comments.push(appComment(11, body));
          return { data: { id: 11 } };
        }),
        deleteComment,
      },
    });

    await expect(
      github.commentOnIssue({
        installationId: 1,
        repo,
        issueNumber: 7,
        marker,
        body: "Opened pull request #12",
      }),
    ).resolves.toEqual({ id: 11, created: true });
    expect(deleteComment).not.toHaveBeenCalled();
    expect(comments.map((comment) => comment.id)).toEqual([4, 5, 11]);
  });
});
