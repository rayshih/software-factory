import { describe, expect, it } from "vitest";
import { StubAgentRuntime } from "../src/agent/stub.js";
import { assertCanTransition, canTransition } from "../src/tasks/status.js";
import { executeRunIssue } from "../src/tasks/run-issue.js";
import { createDeps, labeledPayload, postGithub, zeroResult } from "./helpers.js";

const fix = [{ path: "src/fix.ts", content: "export const fixed = true;\n" }];

describe("status transitions", () => {
  it("allows the factory path and rejects skipping ahead to accepted", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "pr_opened")).toBe(true);
    expect(canTransition("pr_opened", "ci_passed")).toBe(true);
    expect(canTransition("ci_passed", "needs_human")).toBe(true);
    expect(canTransition("needs_human", "accepted")).toBe(true);
    expect(canTransition("needs_human", "rejected")).toBe(true);
    expect(canTransition("pr_opened", "ci_failed")).toBe(true);
    expect(canTransition("needs_human", "queued")).toBe(true);
    expect(canTransition("queued", "accepted")).toBe(false);
    expect(canTransition("running", "accepted")).toBe(false);
    expect(canTransition("accepted", "queued")).toBe(false);
    expect(() => assertCanTransition("failed", "pr_opened")).toThrow(
      /invalid task status transition/,
    );
  });

  it("moves a green check suite to needs_human and an approval to accepted, without merging", async () => {
    const { deps, github } = await createDeps({
      agent: new StubAgentRuntime(zeroResult({ files: fix })),
    });
    const task = await runQueued(deps);
    const opened = await executeRunIssue(deps, { taskId: task.id });
    expect(opened.status).toBe("pr_opened");

    const ci = await postGithub(deps, "check_suite", "ci-success", {
      action: "completed",
      repository: { full_name: "rayshih/sf-demo-todo-api" },
      check_suite: {
        head_branch: "factory/issue-7",
        conclusion: "success",
        pull_requests: [{ number: opened.prNumber }],
      },
    });
    expect(((await ci.json()) as { disposition: string }).disposition).toBe("needs_human");
    const waiting = await deps.store.getTask(task.id);
    expect(waiting?.status).toBe("needs_human");
    expect(waiting?.ciResult).toBe("success");
    const events = await deps.store.listEvents(task.id);
    expect(events.map((event) => event.type)).toContain("ci_passed");

    const review = await postGithub(deps, "pull_request_review", "review-approve", {
      action: "submitted",
      repository: { full_name: "rayshih/sf-demo-todo-api" },
      review: { state: "approved" },
      pull_request: { number: opened.prNumber },
    });
    expect(((await review.json()) as { disposition: string }).disposition).toBe("accepted");
    const accepted = await deps.store.getTask(task.id);
    expect(accepted?.status).toBe("accepted");
    expect(accepted?.reviewOutcome).toBe("approved");
    expect(github.pullsCreated).toHaveLength(1);
    expect("mergePullRequest" in github).toBe(false);
  });

  it("accepts when approval arrives before CI, once CI passes", async () => {
    const { deps } = await createDeps({
      agent: new StubAgentRuntime(zeroResult({ files: fix })),
    });
    const task = await runQueued(deps);
    const opened = await executeRunIssue(deps, { taskId: task.id });
    const early = await postGithub(deps, "pull_request_review", "review-early", {
      action: "submitted",
      repository: { full_name: "rayshih/sf-demo-todo-api" },
      review: { state: "approved" },
      pull_request: { number: opened.prNumber },
    });
    expect(((await early.json()) as { disposition: string }).disposition).toBe(
      "approval_waiting_for_ci",
    );
    expect((await deps.store.getTask(task.id))?.status).toBe("pr_opened");

    const ci = await postGithub(deps, "check_suite", "ci-after-approval", {
      action: "completed",
      repository: { full_name: "rayshih/sf-demo-todo-api" },
      check_suite: {
        conclusion: "success",
        head_branch: "factory/issue-7",
        pull_requests: [{ number: opened.prNumber }],
      },
    });
    expect(((await ci.json()) as { disposition: string }).disposition).toBe("accepted");
    expect((await deps.store.getTask(task.id))?.status).toBe("accepted");
  });

  it("records CI failure and re-queues changes on the same branch without a second pull request", async () => {
    const { deps, github, enqueued } = await createDeps({
      agent: new StubAgentRuntime(zeroResult({ files: fix })),
    });
    const task = await runQueued(deps);
    const opened = await executeRunIssue(deps, { taskId: task.id });
    const before = enqueued.length;

    const failed = await postGithub(deps, "check_suite", "ci-fail", {
      action: "completed",
      repository: { full_name: "rayshih/sf-demo-todo-api" },
      check_suite: {
        conclusion: "failure",
        head_branch: "factory/issue-7",
        pull_requests: [{ number: opened.prNumber }],
      },
    });
    expect(((await failed.json()) as { disposition: string }).disposition).toBe("ci_failed");
    expect((await deps.store.getTask(task.id))?.status).toBe("ci_failed");
    expect((await deps.store.getTask(task.id))?.ciResult).toBe("failure");

    const changes = await postGithub(deps, "pull_request_review", "review-changes", {
      action: "submitted",
      repository: { full_name: "rayshih/sf-demo-todo-api" },
      review: { state: "changes_requested" },
      pull_request: { number: opened.prNumber },
    });
    expect(((await changes.json()) as { disposition: string }).disposition).toBe("requeued");
    const requeued = await deps.store.getTask(task.id);
    expect(requeued?.status).toBe("queued");
    expect(requeued?.branch).toBe("factory/issue-7");
    expect(requeued?.interventions).toBe(1);
    expect(enqueued.length).toBe(before + 1);

    const retried = await executeRunIssue(deps, { taskId: task.id });
    expect(retried.status).toBe("pr_opened");
    expect(retried.prNumber).toBe(opened.prNumber);
    expect(github.pullsCreated).toHaveLength(1);
  });

  it("records a human close as rejected and a human merge as accepted", async () => {
    const { deps, github } = await createDeps({
      agent: new StubAgentRuntime(zeroResult({ files: fix })),
    });
    const task = await runQueued(deps, 8);
    const opened = await executeRunIssue(deps, { taskId: task.id });
    const closed = await postGithub(deps, "pull_request", "pr-closed", {
      action: "closed",
      repository: { full_name: "rayshih/sf-demo-todo-api" },
      pull_request: { number: opened.prNumber, merged: false },
    });
    expect(((await closed.json()) as { disposition: string }).disposition).toBe("rejected");
    expect((await deps.store.getTask(task.id))?.status).toBe("rejected");
    expect(github.pullsCreated).toHaveLength(1);

    const other = await runQueued(deps, 9);
    const otherOpened = await executeRunIssue(deps, { taskId: other.id });
    const merged = await postGithub(deps, "pull_request", "pr-merged", {
      action: "closed",
      repository: { full_name: "rayshih/sf-demo-todo-api" },
      pull_request: { number: otherOpened.prNumber, merged: true },
    });
    expect(((await merged.json()) as { disposition: string }).disposition).toBe("accepted");
    expect((await deps.store.getTask(other.id))?.failureReason ?? null).toBeNull();
  });
});

async function runQueued(deps: Awaited<ReturnType<typeof createDeps>>["deps"], issueNumber = 7) {
  const response = await postGithub(
    deps,
    "issues",
    `delivery-${issueNumber}`,
    labeledPayload({ issueNumber }),
  );
  const body = (await response.json()) as { taskId: string; disposition: string };
  expect(body.disposition).toBe("queued");
  const task = await deps.store.getTask(body.taskId);
  if (!task) throw new Error("missing task");
  return task;
}
