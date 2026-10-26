import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AgentRuntime } from "../src/agent/types.js";
import { FakeGitHub } from "../src/github/fake-github.js";
import { silentLogger } from "../src/log.js";
import type { PipelineDependencies } from "../src/pipeline.js";
import type { TaskRecord, TaskStore } from "../src/store/types.js";
import { ACCEPTED_MARKER, REJECTED_MARKER, branchName } from "../src/tasks/ids.js";
import { applyCheckSuite, applyPullRequestClosed, applyReview } from "../src/tasks/outcomes.js";
import type { TaskStatus } from "../src/tasks/status.js";
import { createTestStore, fixedClock } from "./helpers.js";

const stepsTo: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: [],
  running: ["running"],
  pr_opened: ["running", "pr_opened"],
  ci_passed: ["running", "pr_opened", "ci_passed"],
  ci_failed: ["running", "pr_opened", "ci_failed"],
  needs_human: ["running", "pr_opened", "ci_passed", "needs_human"],
  accepted: ["running", "pr_opened", "ci_passed", "needs_human", "accepted"],
  rejected: ["running", "pr_opened", "ci_passed", "needs_human", "rejected"],
  failed: ["failed"],
};

async function reachStatus(store: TaskStore, id: string, status: TaskStatus): Promise<void> {
  let from: TaskStatus = "queued";
  for (const step of stepsTo[status]) {
    await store.updateTask(id, { status: step }, from);
    from = step;
  }
}

const repo = "rayshih/sf-demo-todo-api";

const agent: AgentRuntime = {
  async run() {
    throw new Error("outcomes do not run the agent");
  },
};

async function setup(status: TaskRecord["status"]) {
  const store = await createTestStore();
  const github = new FakeGitHub();
  github.seedRepo(repo);
  const enqueued: string[] = [];
  const deps: PipelineDependencies = {
    store,
    github,
    agent,
    enqueue: async (task, _options) => {
      enqueued.push(task.id);
      return { id: "run_1" };
    },
    allowedRepos: new Set([repo]),
    baseBranch: "main",
    clock: fixedClock,
    logger: silentLogger,
  };
  const created = await store.createTask({
    id: randomUUID(),
    repo,
    issueNumber: 7,
    attemptGroup: 1,
    branch: branchName(7),
    installationId: 4242,
    issueTitle: "Fix the bug",
    issueBody: "",
    createdAt: fixedClock.now(),
  });
  await reachStatus(store, created.id, status);
  const task = await store.updateTask(created.id, {
    prNumber: 10,
    prUrl: `https://github.com/${repo}/pull/10`,
  });
  return { deps, github, enqueued, task };
}

describe("task outcomes", () => {
  it("moves a green check suite to needs_human", async () => {
    const { deps } = await setup("pr_opened");
    const result = await applyCheckSuite(deps, {
      repo,
      branch: branchName(7),
      prNumber: 10,
      conclusion: "success",
    });
    expect(result.disposition).toBe("needs_human");
    expect(result.task?.status).toBe("needs_human");
    const events = await deps.store.listEvents(result.task?.id ?? "");
    expect(events.map((event) => event.type)).toEqual(["ci_passed", "needs_human"]);
  });

  it("accepts an approval only after CI has passed", async () => {
    const waiting = await setup("pr_opened");
    const early = await applyReview(waiting.deps, { repo, prNumber: 10, state: "approved" });
    expect(early.disposition).toBe("approval_waiting_for_ci");
    expect(early.task?.status).toBe("pr_opened");

    const ready = await setup("needs_human");
    const accepted = await applyReview(ready.deps, { repo, prNumber: 10, state: "APPROVED" });
    expect(accepted.disposition).toBe("accepted");
    expect(accepted.task?.status).toBe("accepted");
    expect(ready.github.commentsCreated).toHaveLength(1);
    expect(ready.github.commentsCreated[0]?.body).toContain(ACCEPTED_MARKER);
  });

  it("requeues on changes requested and records a human close", async () => {
    const requeue = await setup("ci_failed");
    const requeued = await applyReview(requeue.deps, {
      repo,
      prNumber: 10,
      state: "changes_requested",
    });
    expect(requeued.disposition).toBe("requeued");
    expect(requeued.task?.status).toBe("queued");
    expect(requeued.task?.interventions).toBe(1);
    expect(requeued.task?.branch).toBe(branchName(7));
    expect(requeue.enqueued).toEqual([requeued.task?.id]);

    const closed = await setup("needs_human");
    const rejected = await applyPullRequestClosed(closed.deps, {
      repo,
      prNumber: 10,
      merged: false,
    });
    expect(rejected.disposition).toBe("rejected");
    expect(rejected.task?.status).toBe("rejected");
    expect(closed.github.commentsCreated[0]?.body).toContain(REJECTED_MARKER);

    const merged = await setup("needs_human");
    const accepted = await applyPullRequestClosed(merged.deps, {
      repo,
      prNumber: 10,
      merged: true,
    });
    expect(accepted.disposition).toBe("accepted");
    expect(accepted.task?.status).toBe("accepted");
  });
});
