import type { PipelineDependencies } from "../pipeline.js";
import type { TaskRecord } from "../store/types.js";
import { ACCEPTED_MARKER, REJECTED_MARKER, triggerIdempotencyKey } from "./ids.js";
import { canTransition, isTerminal } from "./status.js";
import { transitionTask } from "./transition.js";

export async function applyCheckSuite(
  deps: PipelineDependencies,
  input: {
    repo: string;
    branch: string | null;
    prNumber: number | null;
    conclusion: string | null;
  },
): Promise<{ task: TaskRecord | null; disposition: string }> {
  const task = await findTask(deps, input.repo, input.prNumber, input.branch);
  if (!task) return { task: null, disposition: "ignored_unknown_task" };
  if (task.status !== "pr_opened") {
    await deps.store.appendEvent({
      taskId: task.id,
      type: "ci_ignored",
      message: `Ignored CI conclusion ${input.conclusion ?? "unknown"} while status is ${task.status}`,
      payload: { conclusion: input.conclusion },
      createdAt: deps.clock.now(),
    });
    return { task, disposition: "ci_ignored" };
  }

  if (input.conclusion === "success") {
    let next = await transitionTask(
      deps,
      task,
      "ci_passed",
      { ciResult: "success" },
      { type: "ci_passed", message: "CI passed", payload: { conclusion: input.conclusion } },
    );
    next = await transitionTask(
      deps,
      next,
      "needs_human",
      {},
      {
        type: "needs_human",
        message: "CI passed. A human review is required before this can be accepted.",
      },
    );
    if (next.reviewOutcome === "approved") {
      next = await acceptTask(deps, next, "CI passed after an earlier approval");
      return { task: next, disposition: "accepted" };
    }
    return { task: next, disposition: "needs_human" };
  }

  if (
    input.conclusion === "failure" ||
    input.conclusion === "cancelled" ||
    input.conclusion === "timed_out"
  ) {
    const next = await transitionTask(
      deps,
      task,
      "ci_failed",
      { ciResult: input.conclusion },
      {
        type: "ci_failed",
        message: `CI ${input.conclusion}`,
        payload: { conclusion: input.conclusion },
      },
    );
    return { task: next, disposition: "ci_failed" };
  }

  await deps.store.appendEvent({
    taskId: task.id,
    type: "ci_ignored",
    message: `Ignored CI conclusion ${input.conclusion ?? "unknown"}`,
    payload: { conclusion: input.conclusion },
    createdAt: deps.clock.now(),
  });
  return { task, disposition: "ci_ignored" };
}

export async function applyReview(
  deps: PipelineDependencies,
  input: { repo: string; prNumber: number; state: string },
): Promise<{ task: TaskRecord | null; disposition: string }> {
  const task = await deps.store.findByPullRequest(input.repo, input.prNumber);
  if (!task) return { task: null, disposition: "ignored_unknown_task" };
  if (isTerminal(task.status)) return { task, disposition: "already_terminal" };

  const state = input.state.toLowerCase();
  if (state === "approved") {
    const withReview = await deps.store.updateTask(task.id, { reviewOutcome: "approved" });
    if (withReview.status === "ci_failed") {
      await deps.store.appendEvent({
        taskId: task.id,
        type: "approval_waiting",
        message: "Approval recorded while CI is failing. Not accepted.",
        payload: { state },
        createdAt: deps.clock.now(),
      });
      return { task: withReview, disposition: "approval_waiting" };
    }
    if (withReview.status === "needs_human" || withReview.status === "ci_passed") {
      let next = withReview;
      if (next.status === "ci_passed") {
        next = await transitionTask(
          deps,
          next,
          "needs_human",
          {},
          {
            type: "needs_human",
            message: "Human review is required.",
          },
        );
      }
      next = await acceptTask(deps, next, "Review approved");
      return { task: next, disposition: "accepted" };
    }
    await deps.store.appendEvent({
      taskId: task.id,
      type: "approval_waiting_for_ci",
      message: "Approval recorded. Waiting for CI before accepting.",
      payload: { state },
      createdAt: deps.clock.now(),
    });
    return { task: withReview, disposition: "approval_waiting_for_ci" };
  }

  if (state === "changes_requested") {
    if (task.status === "queued" && task.reviewOutcome === "changes_requested") {
      const idempotencyKey = triggerIdempotencyKey(task);
      const events = await deps.store.listEvents(task.id);
      const enqueueRecorded = events.some(
        (event) =>
          event.type === "enqueued" && event.payload.idempotencyKey === idempotencyKey,
      );
      if (!enqueueRecorded) {
        await enqueueReviewRun(deps, task, idempotencyKey);
        return { task, disposition: "requeued" };
      }
      return { task, disposition: "already_requeued" };
    }
    if (!canTransition(task.status, "queued")) {
      await deps.store.appendEvent({
        taskId: task.id,
        type: "changes_requested_ignored",
        message: `Cannot re-queue from ${task.status}`,
        payload: {},
        createdAt: deps.clock.now(),
      });
      return { task, disposition: "changes_requested_ignored" };
    }
    const next = await transitionTask(
      deps,
      task,
      "queued",
      {
        interventions: task.interventions + 1,
        reviewOutcome: "changes_requested",
        finishedAt: null,
      },
      {
        type: "changes_requested",
        message: "Review requested changes. Re-queued on the same branch.",
        payload: { interventions: task.interventions + 1 },
      },
    );
    await enqueueReviewRun(deps, next, triggerIdempotencyKey(next));
    return { task: next, disposition: "requeued" };
  }

  await deps.store.appendEvent({
    taskId: task.id,
    type: "review_noted",
    message: `Review state ${state} recorded`,
    payload: { state },
    createdAt: deps.clock.now(),
  });
  return { task, disposition: "review_noted" };
}

async function enqueueReviewRun(
  deps: PipelineDependencies,
  task: TaskRecord,
  idempotencyKey: string,
): Promise<void> {
  // Submission and event persistence are not atomic. The stable key makes a
  // retry safe if either the submission or recording its result is ambiguous.
  const run = await deps.enqueue(task, { idempotencyKey });
  await deps.store.appendEvent({
    taskId: task.id,
    type: "enqueued",
    message: `Created review queue run ${run.id}`,
    payload: { runId: run.id, idempotencyKey },
    createdAt: deps.clock.now(),
  });
}

export async function applyPullRequestClosed(
  deps: PipelineDependencies,
  input: { repo: string; prNumber: number; merged: boolean },
): Promise<{ task: TaskRecord | null; disposition: string }> {
  const task = await deps.store.findByPullRequest(input.repo, input.prNumber);
  if (!task) return { task: null, disposition: "ignored_unknown_task" };
  if (isTerminal(task.status)) return { task, disposition: "already_terminal" };
  if (input.merged) {
    if (!canTransition(task.status, "accepted")) {
      await deps.store.appendEvent({
        taskId: task.id,
        type: "close_ignored",
        message: `Observed a merge but cannot accept from ${task.status}`,
        payload: {},
        createdAt: deps.clock.now(),
      });
      return { task, disposition: "close_ignored" };
    }
    const next = await acceptTask(
      deps,
      task,
      "Pull request was merged by a human. This service did not merge it.",
    );
    return { task: next, disposition: "accepted" };
  }
  if (!canTransition(task.status, "rejected")) {
    await deps.store.appendEvent({
      taskId: task.id,
      type: "close_ignored",
      message: `Cannot reject from ${task.status}`,
      payload: {},
      createdAt: deps.clock.now(),
    });
    return { task, disposition: "close_ignored" };
  }
  const next = await transitionTask(
    deps,
    task,
    "rejected",
    {
      reviewOutcome: "closed",
      failureCategory: "rejected",
      failureReason: "Pull request closed without merge",
    },
    { type: "rejected", message: "Pull request closed without merge" },
  );
  await deps.github.commentOnIssue({
    installationId: next.installationId,
    repo: next.repo,
    issueNumber: next.issueNumber,
    marker: REJECTED_MARKER,
    body: ["The pull request was closed without merge.", REJECTED_MARKER].join("\n"),
  });
  return { task: next, disposition: "rejected" };
}

async function acceptTask(
  deps: PipelineDependencies,
  task: TaskRecord,
  message: string,
): Promise<TaskRecord> {
  if (!canTransition(task.status, "accepted")) {
    throw new Error(`invalid task status transition: ${task.status} -> accepted`);
  }
  const next = await transitionTask(
    deps,
    task,
    "accepted",
    { reviewOutcome: task.reviewOutcome ?? "approved" },
    { type: "accepted", message },
  );
  await deps.github.commentOnIssue({
    installationId: next.installationId,
    repo: next.repo,
    issueNumber: next.issueNumber,
    marker: ACCEPTED_MARKER,
    body: [
      "Review accepted this run.",
      "Software Factory will not merge. A human merges if they want the change.",
      ACCEPTED_MARKER,
    ].join("\n"),
  });
  return next;
}

async function findTask(
  deps: PipelineDependencies,
  repo: string,
  prNumber: number | null,
  branch: string | null,
): Promise<TaskRecord | null> {
  if (prNumber !== null) {
    const byPr = await deps.store.findByPullRequest(repo, prNumber);
    if (byPr) return byPr;
  }
  if (branch) return deps.store.findByBranch(repo, branch);
  return null;
}
