import { describe, expect, it } from "vitest";
import { FakeGitHub } from "../src/github/fake-github.js";
import { PushRejectedError } from "../src/github/push-guard.js";

const repo = "rayshih/sf-demo-todo-api";
const branch = "factory/issue-7";

function github(): FakeGitHub {
  const client = new FakeGitHub();
  client.seedRepo(repo);
  return client;
}

async function push(
  client: FakeGitHub,
  files: { path: string; content: string }[],
  extra?: {
    allowedRepos?: ReadonlySet<string>;
    limits?: { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number };
  },
) {
  await client.ensureBranch({
    installationId: 1,
    repo,
    branch,
    baseBranch: "main",
  });
  return client.pushFiles({
    installationId: 1,
    repo,
    branch,
    issueNumber: 7,
    files,
    ...extra,
  });
}

describe("push guard", () => {
  it("rejects git metadata, path escapes, and secret-like files before writing", async () => {
    const client = github();
    const blocked = [
      ".git/config",
      ".GIT/config",
      "src/.Git/hooks/post-checkout",
      "../secret.txt",
      "/etc/passwd",
      "src\\fix.ts",
      "src//fix.ts",
      ".env",
      ".ENV",
      ".Env.production",
      "keys/ID_RSA",
      "config/Credentials.json",
      "keys/deploy.pem",
    ];
    for (const path of blocked) {
      await expect(push(client, [{ path, content: "x\n" }])).rejects.toBeInstanceOf(
        PushRejectedError,
      );
    }
    expect(client.pushesCreated).toBe(0);
  });

  it("rejects a branch or repository outside the factory rules", async () => {
    const client = github();
    await client.ensureBranch({ installationId: 1, repo, branch, baseBranch: "main" });
    await expect(
      client.pushFiles({
        installationId: 1,
        repo,
        branch: "main",
        issueNumber: 7,
        files: [{ path: "src/fix.ts", content: "ok\n" }],
        allowedRepos: new Set([repo]),
      }),
    ).rejects.toBeInstanceOf(PushRejectedError);
    await expect(
      client.pushFiles({
        installationId: 1,
        repo: "other/repo",
        branch,
        issueNumber: 7,
        files: [{ path: "src/fix.ts", content: "ok\n" }],
        allowedRepos: new Set([repo]),
      }),
    ).rejects.toBeInstanceOf(PushRejectedError);
    await expect(
      client.pushFiles({
        installationId: 1,
        repo,
        branch: "factory/issue-8",
        issueNumber: 7,
        files: [{ path: "src/fix.ts", content: "ok\n" }],
        allowedRepos: new Set([repo]),
      }),
    ).rejects.toBeInstanceOf(PushRejectedError);
    expect(client.pushesCreated).toBe(0);
  });

  it("rejects pushes over the file count and size limits", async () => {
    const client = github();
    await expect(
      push(client, [{ path: "a.txt", content: "hello\n" }], { limits: { maxFileBytes: 2 } }),
    ).rejects.toBeInstanceOf(PushRejectedError);
    await expect(
      push(
        client,
        [
          { path: "a.txt", content: "a\n" },
          { path: "b.txt", content: "b\n" },
        ],
        { limits: { maxFiles: 1 } },
      ),
    ).rejects.toBeInstanceOf(PushRejectedError);
    expect(client.pushesCreated).toBe(0);
  });

  it("allows a workflow edit and records it as sensitive", async () => {
    const client = github();
    const pushed = await push(client, [
      { path: ".github/workflows/ci.yml", content: "name: ci\n" },
    ]);
    expect(pushed.sensitivePaths).toEqual([".github/workflows/ci.yml"]);
    expect(client.pushesCreated).toBe(1);
    await client.seedOpenPullRequest(repo, branch);
    // seed creates a pull without commits from this push; open still needs aheadBy.
    const opened = await client.openPullRequest({
      installationId: 1,
      repo,
      headBranch: branch,
      baseBranch: "main",
      title: "Fix",
      body: "body",
      sensitivePaths: pushed.sensitivePaths,
    });
    const pull = client.openPulls(repo).find((item) => item.number === opened.number);
    expect(pull?.labels).toContain("touches-sensitive-paths");
    expect(pull?.body).toContain("touches-sensitive-paths:");
    expect(pull?.body).toContain(".github/workflows/ci.yml");
  });
});
