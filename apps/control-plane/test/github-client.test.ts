import { describe, expect, it } from "vitest";
import { FakeGitHub } from "../src/github/fake-github.js";

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
    });
    const again = await github.openPullRequest({
      installationId: 1,
      repo,
      headBranch: "factory/issue-7",
      baseBranch: "main",
      title: "Fix again",
      body: "updated",
    });
    expect(opened.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.number).toBe(opened.number);
    expect(github.pullsCreated).toHaveLength(1);
    expect(github.openPullRequestCalls).toBe(2);
    expect(github.openPulls(repo)[0]?.title).toBe("Fix again");
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
    });
    expect(opened.created).toBe(false);
    expect(opened.number).toBe(seeded.number);
    expect(github.pullsCreated).toHaveLength(0);
  });

  it("posts one issue comment per marker", async () => {
    const github = new FakeGitHub();
    github.seedRepo(repo);
    const marker = "<!-- software-factory:pr-link -->";
    const first = await github.commentOnIssue({
      installationId: 1,
      repo,
      issueNumber: 7,
      marker,
      body: `Opened ${marker}`,
    });
    const second = await github.commentOnIssue({
      installationId: 1,
      repo,
      issueNumber: 7,
      marker,
      body: `Opened again ${marker}`,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(github.commentsCreated).toHaveLength(1);
  });
});
