import { randomUUID } from "node:crypto";
import type { AgentRunResult } from "../agent/types.js";
import type { PipelineDependencies } from "../pipeline.js";
import { LeaseHeldError, StaleRunError, type TaskRecord } from "../store/types.js";
import { PR_LINK_MARKER } from "./ids.js";
import { transitionTask } from "./transition.js";

const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_RENEW_MS = 20_000;

export interface RunIssuePayload {
  taskId: string;
}

const IDLE_WITHOUT_PR =
  "Agent session went idle without an open pull request. An idle session is not a completed task.";

/**
 * Runs one issue attempt. Safe to call again: branch creation, push, pull request,
 * and the issue comment all no-op when they already happened.
 * A pull request is opened only when the branch is ahead of the base.
 * The agent session ending, including going idle, does not by itself finish the task.
 */
export async function executeRunIssue(
  deps: PipelineDependencies,
  payload: RunIssuePayload,
): Promise<TaskRecord> {
  const existing = await deps.store.getTask(payload.taskId);
  if (!existing) throw new Error(`task ${payload.taskId} not found`);
  if (
    existing.status === "accepted" ||
    existing.status === "rejected" ||
    existing.status === "failed"
  ) {
    return existing;
  }
  if (!deps.allowedRepos.has(existing.repo)) {
    throw new Error(`repository ${existing.repo} is not allowlisted`);
  }

  if (
    existing.status !== "queued" &&
    existing.status !== "ci_failed" &&
    existing.status !== "running"
  ) {
    return healPullRequest(deps, existing);
  }
  const now = deps.clock.now();
  if (existing.status === "running" && leaseIsCurrent(existing, now)) {
    throw new LeaseHeldError(existing.id);
  }

  const runId = randomUUID();
  const leaseMs = deps.leaseDurationMs ?? DEFAULT_LEASE_MS;
  const claimed = await deps.store.claimRun(existing.id, {
    runId,
    expectedStatus: existing.status,
    leaseExpiresAt: new Date(now.getTime() + leaseMs),
    now,
  });
  if (!claimed) throw new LeaseHeldError(existing.id);
  await deps.store.appendEvent({
    taskId: claimed.id,
    type: existing.status === "running" ? "run_retry" : "run_started",
    message:
      existing.status === "running"
        ? `Took over attempt ${claimed.attempts}`
        : `Attempt ${claimed.attempts} started`,
    payload: { runId },
    createdAt: now,
  });

  let lostLease = false;
  const renewMs = deps.leaseRenewIntervalMs ?? DEFAULT_RENEW_MS;
  const renewTimer =
    renewMs > 0
      ? setInterval(() => {
          const renewedAt = deps.clock.now();
          void deps.store
            .renewRun(claimed.id, runId, new Date(renewedAt.getTime() + leaseMs), renewedAt)
            .then((owned) => {
              if (!owned) lostLease = true;
            });
        }, renewMs)
      : undefined;
  renewTimer?.unref();

  try {
    let task = claimed;
    await requireRun(deps, task.id, runId);
    await deps.github.ensureBranch({
      installationId: task.installationId,
      repo: task.repo,
      branch: task.branch,
      baseBranch: deps.baseBranch,
    });

    const token = await deps.github.getInstallationToken(task.installationId);
    const result = await deps.agent.run({
      taskId: task.id,
      repo: task.repo,
      issueNumber: task.issueNumber,
      issueTitle: task.issueTitle,
      issueBody: task.issueBody,
      branch: task.branch,
      baseBranch: deps.baseBranch,
      attempt: task.attempts,
      installationToken: token,
    });
    if (lostLease) throw new StaleRunError(task.id, runId);

    task = await deps.store.updateTask(
      task.id,
      {
        costUsdDelta: result.costUsd,
        tokensDelta: result.tokens,
        interventionsDelta: result.interventions,
        humanInterventionMinutesDelta: result.humanInterventionMinutes,
      },
      undefined,
      runId,
    );
    await deps.store.appendEvent({
      taskId: task.id,
      type: "agent_finished",
      message: result.summary,
      payload: {
        sessionStatus: result.sessionStatus,
        costUsd: result.costUsd,
        tokens: result.tokens,
        interventions: result.interventions,
        runId,
      },
      createdAt: deps.clock.now(),
    });

    await requireRun(deps, task.id, runId);
    if (result.files.length > 0) {
      await deps.github.pushFiles({
        installationId: task.installationId,
        repo: task.repo,
        branch: task.branch,
        issueNumber: task.issueNumber,
        files: result.files,
      });
    }

    await requireRun(deps, task.id, runId);
    const comparison = await deps.github.compare({
      installationId: task.installationId,
      repo: task.repo,
      base: deps.baseBranch,
      head: task.branch,
    });
    if (comparison.aheadBy > 0) {
      return recordPullRequest(deps, task, result.summary, runId);
    }

    const failure = failureForEmptySession(result);
    return transitionTask(
      deps,
      task,
      "failed",
      { failureReason: failure.reason, failureCategory: failure.category },
      {
        type: "run_failed",
        message: failure.reason,
        payload: { sessionStatus: result.sessionStatus, runId },
      },
      runId,
    );
  } finally {
    if (renewTimer) clearInterval(renewTimer);
  }
}

async function healPullRequest(deps: PipelineDependencies, task: TaskRecord): Promise<TaskRecord> {
  const comparison = await deps.github.compare({
    installationId: task.installationId,
    repo: task.repo,
    base: deps.baseBranch,
    head: task.branch,
  });
  if (comparison.aheadBy < 1) return task;
  return recordPullRequest(deps, task, task.issueTitle);
}

async function recordPullRequest(
  deps: PipelineDependencies,
  task: TaskRecord,
  summary: string,
  runId?: string,
): Promise<TaskRecord> {
  const title = `[factory] ${task.issueTitle} (#${task.issueNumber})`.slice(0, 240);
  const body = [
    `Refs #${task.issueNumber}`,
    "",
    summary,
    "",
    "Human review is required. Software Factory does not merge pull requests.",
    PR_LINK_MARKER,
  ].join("\n");
  if (runId) await requireRun(deps, task.id, runId);
  const pull = await deps.github.openPullRequest({
    installationId: task.installationId,
    repo: task.repo,
    headBranch: task.branch,
    baseBranch: deps.baseBranch,
    title,
    body,
  });

  if (runId) await requireRun(deps, task.id, runId);
  const comment = await deps.github.commentOnIssue({
    installationId: task.installationId,
    repo: task.repo,
    issueNumber: task.issueNumber,
    marker: PR_LINK_MARKER,
    body: [
      `Opened a pull request for this issue: ${pull.url}`,
      "",
      "A human still has to review it. Software Factory will not merge.",
      PR_LINK_MARKER,
    ].join("\n"),
  });
  await deps.store.appendEvent({
    taskId: task.id,
    type: comment.created ? "issue_comment" : "issue_comment_reused",
    message: comment.created
      ? "Commented on the issue with the pull request link"
      : "Issue comment already present",
    payload: { commentId: comment.id, runId },
    createdAt: deps.clock.now(),
  });

  if (task.status === "running") {
    return transitionTask(
      deps,
      task,
      "pr_opened",
      { prNumber: pull.number, prUrl: pull.url },
      {
        type: pull.created ? "pr_opened" : "pr_reused",
        message: pull.created ? `Opened ${pull.url}` : `Reused open pull request ${pull.url}`,
        payload: { prNumber: pull.number, prUrl: pull.url, created: pull.created, runId },
      },
      runId,
    );
  }
  if (task.prNumber !== pull.number || task.prUrl !== pull.url) {
    const next = await deps.store.updateTask(
      task.id,
      { prNumber: pull.number, prUrl: pull.url },
      undefined,
      runId,
    );
    await deps.store.appendEvent({
      taskId: task.id,
      type: "pr_reused",
      message: `Recorded existing pull request ${pull.url}`,
      payload: { prNumber: pull.number, prUrl: pull.url, created: pull.created },
      createdAt: deps.clock.now(),
    });
    return next;
  }
  return task;
}

function leaseIsCurrent(task: TaskRecord, now: Date): boolean {
  return task.leaseExpiresAt !== null && task.leaseExpiresAt.getTime() > now.getTime();
}

async function requireRun(
  deps: PipelineDependencies,
  taskId: string,
  runId: string,
): Promise<TaskRecord> {
  const current = await deps.store.getTask(taskId);
  if (!current || current.runId !== runId) throw new StaleRunError(taskId, runId);
  return current;
}

function failureForEmptySession(result: AgentRunResult): { reason: string; category: string } {
  if (result.sessionStatus === "idle") {
    return { reason: IDLE_WITHOUT_PR, category: "idle_without_pr" };
  }
  if (result.sessionStatus === "error" || result.sessionStatus === "terminated") {
    return {
      reason:
        `Agent session ended (${result.sessionStatus}) without an open pull request. ${result.summary}`.slice(
          0,
          2000,
        ),
      category: "agent_error",
    };
  }
  return {
    reason: `Agent runtime finished without an open pull request (session status: ${result.sessionStatus}). An idle or empty session is not a completed task.`,
    category: "no_changes",
  };
}

export async function markTaskFailedIfRunning(
  deps: PipelineDependencies,
  taskId: string,
  error: unknown,
): Promise<void> {
  const task = await deps.store.getTask(taskId);
  if (!task || task.status !== "running") return;
  const message = error instanceof Error ? error.message : "run failed";
  await transitionTask(
    deps,
    task,
    "failed",
    { failureReason: message.slice(0, 2000), failureCategory: "run_error" },
    { type: "run_failed", message: message.slice(0, 500) },
  );
}
