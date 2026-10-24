import { task } from "@trigger.dev/sdk";
import { getPipeline } from "../src/dependencies.js";
import {
  executeRunIssue,
  markTaskFailedIfRunning,
  type RunIssuePayload,
} from "../src/tasks/run-issue.js";

/**
 * Global cap of 2, and 1 run per repository via concurrencyKey = repo.
 * queue.concurrencyLimit remains for compatibility with the v3 queue shape.
 * Retries reuse the task row, the factory/issue-<n> branch, and the open PR.
 */
export const runIssue = task({
  id: "run-issue",
  queue: {
    name: "run-issue",
    concurrencyLimit: 2,
  },
  concurrency: { total: 2, perKey: 1 },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 60_000,
    randomize: true,
  },
  maxDuration: 1800,
  run: async (payload: RunIssuePayload) => {
    const deps = await getPipeline();
    const taskRecord = await executeRunIssue(deps, payload);
    return {
      taskId: taskRecord.id,
      status: taskRecord.status,
      prUrl: taskRecord.prUrl,
    };
  },
  onFailure: async ({ payload, error }) => {
    const deps = await getPipeline();
    const taskId = (payload as RunIssuePayload | undefined)?.taskId;
    if (!taskId) return;
    await markTaskFailedIfRunning(deps, taskId, error);
  },
});
