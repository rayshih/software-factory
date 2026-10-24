import { describe, expect, it } from "vitest";
import { StubAgentRuntime } from "../src/agent/stub.js";
import { executeRunIssue } from "../src/tasks/run-issue.js";
import { createDeps, zeroResult } from "./helpers.js";

const fix = [{ path: "src/fix.ts", content: "export const fixed = true;\n" }];

describe("idempotent pull request creation", () => {
  it("opens one pull request and reuses it when the run is retried", async () => {
    const { deps, github } = await createDeps({
      agent: new StubAgentRuntime(
        zeroResult({ sessionStatus: "idle", files: fix, summary: "pushed the fix" }),
      ),
    });
    const task = await queue(deps);
    const first = await executeRunIssue(deps, { taskId: task.id });
    expect(first.status).toBe("pr_opened");
    expect(first.prNumber).toBe(1);
    expect(first.prUrl).toBe("https://github.com/rayshih/sf-demo-todo-api/pull/1");
    expect(github.pullsCreated).toHaveLength(1);
    expect(github.commentsCreated).toHaveLength(1);
    expect(github.pushesCreated).toBe(1);

    await deps.store.updateTask(task.id, { status: "running", prNumber: null, prUrl: null });
    const second = await executeRunIssue(deps, { taskId: task.id });
    expect(second.status).toBe("pr_opened");
    expect(second.prNumber).toBe(1);
    expect(github.pullsCreated).toHaveLength(1);
    expect(github.openPullRequestCalls).toBe(2);
    expect(github.commentsCreated).toHaveLength(1);
    expect(github.pushesCreated).toBe(1);
    expect(github.openPulls("rayshih/sf-demo-todo-api")).toHaveLength(1);
  });

  it("reuses an open pull request that already exists for the branch", async () => {
    const { deps, github } = await createDeps({
      agent: new StubAgentRuntime(zeroResult({ files: fix })),
    });
    github.seedOpenPullRequest("rayshih/sf-demo-todo-api", "factory/issue-7");
    const task = await queue(deps);
    const result = await executeRunIssue(deps, { taskId: task.id });
    expect(result.prNumber).toBe(1);
    expect(github.pullsCreated).toHaveLength(0);
    expect(github.openPulls("rayshih/sf-demo-todo-api")).toHaveLength(1);
  });

  it("does not treat an idle session without commits as done", async () => {
    const { deps, github } = await createDeps({
      agent: new StubAgentRuntime(
        zeroResult({ sessionStatus: "idle", files: [], costUsd: "0.000000" }),
      ),
    });
    const task = await queue(deps);
    const result = await executeRunIssue(deps, { taskId: task.id });
    expect(result.status).toBe("failed");
    expect(result.failureCategory).toBe("idle_without_pr");
    expect(result.failureReason).toContain("idle session is not a completed task");
    expect(result.prNumber).toBeNull();
    expect(github.pullsCreated).toHaveLength(0);
    expect(result.costUsd).toBe("0.000000");
    expect(result.tokens).toBe(0);
    expect(result.interventions).toBe(0);
    expect(result.humanInterventionMinutes).toBe(0);
  });

  it("records cost from the agent and still requires a pull request, not an idle session", async () => {
    const { deps } = await createDeps({
      agent: new StubAgentRuntime(
        zeroResult({
          sessionStatus: "idle",
          files: fix,
          costUsd: "1.250000",
          tokens: 40,
          humanInterventionMinutes: 0,
        }),
      ),
    });
    const task = await queue(deps);
    const result = await executeRunIssue(deps, { taskId: task.id });
    expect(result.status).toBe("pr_opened");
    expect(result.status).not.toBe("accepted");
    expect(result.costUsd).toBe("1.250000");
    expect(result.tokens).toBe(40);
    const events = await deps.store.listEvents(task.id);
    expect(events.some((event) => event.type === "agent_finished")).toBe(true);
  });
});

async function queue(deps: Awaited<ReturnType<typeof createDeps>>["deps"]) {
  const { postGithub, labeledPayload } = await import("./helpers.js");
  const response = await postGithub(deps, "issues", `delivery-${Math.random()}`, labeledPayload());
  const body = (await response.json()) as { taskId: string };
  const task = await deps.store.getTask(body.taskId);
  if (!task) throw new Error("task was not queued");
  return task;
}
