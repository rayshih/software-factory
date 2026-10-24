import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_TASK_COMPLETION } from "../src/agent/types.js";
import {
  AnthropicManagedAgentRuntime,
  type ManagedAgentClient,
} from "../src/agent/anthropic-managed.js";
import type { AgentRunRequest } from "../src/agent/types.js";

const banned = [
  /pulls\.merge\b/,
  /repos\.merge\b/,
  /mergePullRequest/,
  /merge_method/,
  /\/merges\b/,
];

describe("no merge code", () => {
  it("does not call the GitHub merge API anywhere in the service", () => {
    const files = walk("src").concat(walk("trigger"), walk("scripts"));
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of banned) {
        if (pattern.test(source)) offenders.push(`${file} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("managed agent runtime", () => {
  it("reports an idle session as not complete and returns no files for the control plane to treat as done", async () => {
    const client: ManagedAgentClient = {
      async run() {
        return {
          status: "idle",
          stopReason: "end_turn",
          errorMessage: null,
          costUsd: "0.000000",
          tokens: 0,
        };
      },
    };
    const runtime = new AnthropicManagedAgentRuntime(client, 1000);
    const result = await runtime.run(request);
    expect(result.sessionStatus).toBe("idle");
    expect(result.files).toEqual([]);
    expect(result.summary).toContain(NOT_TASK_COMPLETION);
    expect(result.costUsd).toBe("0.000000");
  });
});

const request: AgentRunRequest = {
  taskId: "task-1",
  repo: "rayshih/sf-demo-todo-api",
  issueNumber: 1,
  issueTitle: "Fix",
  issueBody: "body",
  branch: "factory/issue-1",
  baseBranch: "main",
  attempt: 1,
  installationToken: "ghs_test",
};

function walk(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else if (entry.endsWith(".ts")) files.push(path);
  }
  return files;
}
