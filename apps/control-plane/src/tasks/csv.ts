import type { TaskRecord } from "../store/types.js";

/** Same columns as metrics/tracker.csv, in the same order. */
export const TRACKER_COLUMNS = [
  "task_id",
  "issue",
  "repo",
  "status",
  "start",
  "end",
  "duration",
  "retries",
  "tokens",
  "cost_usd",
  "ci_result",
  "review_outcome",
  "human_intervention_minutes",
  "failure_category",
] as const;

export function tasksToCsv(tasks: readonly TaskRecord[]): string {
  const lines = [TRACKER_COLUMNS.join(",")];
  for (const task of tasks) {
    const start = task.startedAt;
    const end = task.finishedAt;
    const duration =
      start && end ? String(Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000))) : "";
    lines.push(
      [
        task.id,
        task.issueNumber,
        task.repo,
        task.status,
        start ? start.toISOString() : "",
        end ? end.toISOString() : "",
        duration,
        Math.max(0, task.attempts - 1),
        task.tokens,
        task.costUsd,
        task.ciResult,
        task.reviewOutcome,
        task.humanInterventionMinutes,
        task.failureCategory,
      ]
        .map((value) => csvField(value))
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
