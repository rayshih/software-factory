import { describe, expect, it } from "vitest";
import { DuplicateFilePathError } from "../src/github/content-hash.js";
import { FakeGitHub } from "../src/github/fake-github.js";
import { operationMarker } from "../src/github/issue-comment.js";

const repo = "rayshih/sf-demo-todo-api";
const files = [{ path: "src/fix.ts", content: "export const fixed = true;\n" }];

describe("FakeGitHub", () => {
  it("creates a branch and pull request once, then repeats as no-ops", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    const firstBranch = await github.ensureBranch({
      installationId: 1,
      repo,
      branch: "factory/issue-7",
      baseBranch: "main",
    });
    const secondBranch = await github.ensureBranch({
      installationId: 1,
      repo,
      branch: "factory/issue-7",
      baseBranch: "main",
    });
    expect(firstBranch.created).toBe(true);
    expect(secondBranch.created).toBe(false);
    expect(secondBranch.sha).toBe(firstBranch.sha);

    const pushed = await github.pushFiles({
      installationId: 1,
      repo,
      branch: "factory/issue-7",
      issueNumber: 7,
      files,
    });
    const pushedAgain = await github.pushFiles({
      installationId: 1,
      repo,
      branch: "factory/issue-7",
      issueNumber: 7,
      files,
    });
    expect(pushed.created).toBe(true);
    expect(pushedAgain.created).toBe(false);
    expect(pushedAgain.sha).toBe(pushed.sha);
    expect(github.pushCalls).toBe(2);
    expect(github.pushesCreated).toBe(1);

    const opened = await github.openPullRequest({
      installationId: 1,
      repo,
      headBranch: "factory/issue-7",
      baseBranch: "main",
      title: "Fix",
      body: "body",
      sensitivePaths: pushed.sensitivePaths,
    });
    const again = await github.openPullRequest({
      installationId: 1,
      repo,
      headBranch: "factory/issue-7",
      baseBranch: "main",
      title: "Fix again",
      body: "updated",
      sensitivePaths: pushed.sensitivePaths,
    });
    expect(opened.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.number).toBe(opened.number);
    expect(github.pullsCreated).toHaveLength(1);
    expect(github.openPullRequestCalls).toBe(2);
    expect(github.openPulls(repo)[0]?.title).toBe("Fix");
    expect(github.openPulls(repo)[0]?.body).toBe("body");
  });

  it("does not open a pull request when the branch has no new commits", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    await github.ensureBranch({
      installationId: 1,
      repo,
      branch: "factory/issue-7",
      baseBranch: "main",
    });
    await expect(
      github.openPullRequest({
        installationId: 1,
        repo,
        headBranch: "factory/issue-7",
        baseBranch: "main",
        title: "Fix",
        body: "body",
        sensitivePaths: [],
      }),
    ).rejects.toThrow(/No commits between/);
  });

  it("reuses an already open pull request from the same branch", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    const seeded = github.seedOpenPullRequest(repo, "factory/issue-7");
    const opened = await github.openPullRequest({
      installationId: 1,
      repo,
      headBranch: "factory/issue-7",
      baseBranch: "main",
      title: "Retitled",
      body: "updated",
      sensitivePaths: [],
    });
    expect(opened.created).toBe(false);
    expect(opened.number).toBe(seeded.number);
    expect(github.pullsCreated).toHaveLength(0);
    expect(github.openPulls(repo)[0]?.title).toBe("existing");
    expect(github.openPulls(repo)[0]?.body).toBe("existing");
  });

  it("does not reuse an open pull request targeting a different base branch", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    await github.ensureBranch({
      installationId: 1,
      repo,
      branch: "release",
      baseBranch: "main",
    });
    const mainPull = github.seedOpenPullRequest(repo, "factory/issue-7", "main");
    const releasePull = await github.openPullRequest({
      installationId: 1,
      repo,
      headBranch: "factory/issue-7",
      baseBranch: "release",
      title: "Release fix",
      body: "release body",
      sensitivePaths: [],
    });
    expect(releasePull.created).toBe(true);
    expect(releasePull.number).not.toBe(mainPull.number);
    expect(github.openPulls(repo)).toHaveLength(2);
  });

  it("recognizes an earlier content hash after a later push", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    await github.ensureBranch({
      installationId: 1,
      repo,
      branch: "factory/issue-7",
      baseBranch: "main",
    });
    const first = await github.pushFiles({
      installationId: 1,
      repo,
      branch: "factory/issue-7",
      issueNumber: 7,
      files,
    });
    const second = await github.pushFiles({
      installationId: 1,
      repo,
      branch: "factory/issue-7",
      issueNumber: 7,
      files: [{ path: "src/other.ts", content: "export const other = true;\n" }],
    });
    const repeated = await github.pushFiles({
      installationId: 1,
      repo,
      branch: "factory/issue-7",
      issueNumber: 7,
      files,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(repeated).toEqual({ sha: second.sha, created: false });
    expect(github.pushesCreated).toBe(2);
  });

  it("does not conflate identical file changes for different issues", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    await github.ensureBranch({
      installationId: 1,
      repo,
      branch: "factory/shared",
      baseBranch: "main",
    });
    const issueSeven = await github.pushFiles({
      installationId: 1,
      repo,
      branch: "factory/shared",
      issueNumber: 7,
      files,
    });
    await github.pushFiles({
      installationId: 1,
      repo,
      branch: "factory/shared",
      issueNumber: 7,
      files: [{ path: "src/fix.ts", content: "export const fixed = false;\n" }],
    });
    const issueEight = await github.pushFiles({
      installationId: 1,
      repo,
      branch: "factory/shared",
      issueNumber: 8,
      files,
    });
    const issueSevenRetry = await github.pushFiles({
      installationId: 1,
      repo,
      branch: "factory/shared",
      issueNumber: 7,
      files,
    });

    expect(issueSeven.created).toBe(true);
    expect(issueEight.created).toBe(true);
    expect(issueSevenRetry).toEqual({ sha: issueEight.sha, created: false });
    expect(github.pushesCreated).toBe(3);
  });

  it("does not inherit push fingerprints from a base branch", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    await github.pushFiles({
      installationId: 1,
      repo,
      branch: "main",
      issueNumber: 7,
      files,
    });
    await github.ensureBranch({
      installationId: 1,
      repo,
      branch: "factory/issue-7-retry",
      baseBranch: "main",
    });

    const first = await github.pushFiles({
      installationId: 1,
      repo,
      branch: "factory/issue-7-retry",
      issueNumber: 7,
      files,
    });
    const repeated = await github.pushFiles({
      installationId: 1,
      repo,
      branch: "factory/issue-7-retry",
      issueNumber: 7,
      files,
    });

    expect(first.created).toBe(true);
    expect(repeated).toEqual({ sha: first.sha, created: false });
    expect(github.pushesCreated).toBe(2);
  });

  it("rejects a duplicate file path before writing a commit", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    await github.ensureBranch({
      installationId: 1,
      repo,
      branch: "factory/issue-7",
      baseBranch: "main",
    });
    const before = github.openPulls(repo);

    await expect(
      github.pushFiles({
        installationId: 1,
        repo,
        branch: "factory/issue-7",
        issueNumber: 7,
        files: [files[0]!, { path: "src/fix.ts", content: "export const other = true;\n" }],
      }),
    ).rejects.toBeInstanceOf(DuplicateFilePathError);
    expect(github.pushesCreated).toBe(0);
    expect(before).toHaveLength(0);
  });

  it("posts one issue comment per marker when the body omits the marker", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    const marker = operationMarker("pr-link");
    const first = await github.commentOnIssue({
      installationId: 1,
      repo,
      issueNumber: 7,
      marker,
      body: "Opened pull request #12",
    });
    const second = await github.commentOnIssue({
      installationId: 1,
      repo,
      issueNumber: 7,
      marker,
      body: "Opened pull request #12",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(github.commentsCreated).toHaveLength(1);
    expect(github.commentsCreated[0]?.body).toContain(marker);
  });

  it("posts again when a human comment only quotes the operation marker", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    const marker = operationMarker("pr-link");
    github.seedIssueComment(repo, 7, `The bot used ${marker} in its note.`);
    const posted = await github.commentOnIssue({
      installationId: 1,
      repo,
      issueNumber: 7,
      marker,
      body: "Opened pull request #12",
    });
    expect(posted.created).toBe(true);
    expect(github.commentsCreated).toHaveLength(1);
    expect(github.commentsCreated[0]?.body.split("\n").at(-1)).toBe(marker);
  });

  it("does not reuse an exact operation marker from a human comment", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    const marker = operationMarker("pr-link");
    github.seedIssueComment(repo, 7, marker);

    const posted = await github.commentOnIssue({
      installationId: 1,
      repo,
      issueNumber: 7,
      marker,
      body: "Opened pull request #12",
    });

    expect(posted.created).toBe(true);
    expect(github.commentsCreated).toHaveLength(1);
  });

  it("reuses an app-owned comment with the exact operation marker", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    const marker = operationMarker("pr-link");
    const seededId = github.seedIssueComment(repo, 7, marker, { appOwned: true });

    const posted = await github.commentOnIssue({
      installationId: 1,
      repo,
      issueNumber: 7,
      marker,
      body: "Opened pull request #12",
    });

    expect(posted).toEqual({ id: seededId, created: false });
    expect(github.commentsCreated).toHaveLength(0);
  });

  it("reports behind when only the base branch moves", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    await github.ensureBranch({
      installationId: 1,
      repo,
      branch: "feature",
      baseBranch: "main",
    });
    await github.pushFiles({
      installationId: 1,
      repo,
      branch: "main",
      issueNumber: 1,
      files: [{ path: "src/base.ts", content: "export const baseMoved = true;\n" }],
    });

    await expect(
      github.compare({ installationId: 1, repo, base: "main", head: "feature" }),
    ).resolves.toEqual({ aheadBy: 0, behindBy: 1, status: "behind" });
  });

  it("reports diverged after both branches move", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    await github.ensureBranch({
      installationId: 1,
      repo,
      branch: "feature",
      baseBranch: "main",
    });
    await github.pushFiles({
      installationId: 1,
      repo,
      branch: "feature",
      issueNumber: 1,
      files,
    });
    await github.pushFiles({
      installationId: 1,
      repo,
      branch: "main",
      issueNumber: 2,
      files: [{ path: "src/base.ts", content: "export const baseMoved = true;\n" }],
    });

    await expect(
      github.compare({ installationId: 1, repo, base: "main", head: "feature" }),
    ).resolves.toEqual({ aheadBy: 1, behindBy: 1, status: "diverged" });
  });
});
