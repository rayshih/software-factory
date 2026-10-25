import { operationMarker } from "../github/issue-comment.js";

/** Deterministic branch reused by every retry of an issue. */
export function branchName(issueNumber: number): string {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`invalid issue number: ${issueNumber}`);
  }
  return `factory/issue-${issueNumber}`;
}

/** `owner/repo#issue#attemptGroup`. Retries share one key; a new group starts after a terminal task. */
export function idempotencyKey(repo: string, issueNumber: number, attemptGroup: number): string {
  return `${repo}#${issueNumber}#${attemptGroup}`;
}

/**
 * Trigger.dev idempotency key. Includes attempts and interventions so a human
 * "changes requested" re-queue is a new run, while a webhook retry of the same
 * queueing is not.
 */
export function triggerIdempotencyKey(task: {
  idempotencyKey: string;
  attempts: number;
  interventions: number;
}): string {
  return `${task.idempotencyKey}:attempts-${task.attempts}:interventions-${task.interventions}`;
}

export const PR_LINK_MARKER = operationMarker("pr-link");
export const ACCEPTED_MARKER = operationMarker("accepted");
export const REJECTED_MARKER = operationMarker("rejected");
