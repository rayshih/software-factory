import { randomUUID } from "node:crypto";
import { z } from "zod";
import { verifyGithubSignature } from "../github/signature.js";
import { normalizeRepo } from "../github/repo.js";
import type { WebhookDependencies } from "../pipeline.js";
import { isUniqueViolation } from "../github/errors.js";
import { branchName } from "../tasks/ids.js";
import { applyCheckSuite, applyPullRequestClosed, applyReview } from "../tasks/outcomes.js";

const labeledPayload = z.object({
  action: z.string(),
  installation: z.object({ id: z.number() }).optional(),
  repository: z.object({ full_name: z.string() }),
  issue: z.object({
    number: z.number().int().positive(),
    title: z.string().optional(),
    body: z.string().nullable().optional(),
    pull_request: z.unknown().optional(),
  }),
  label: z.object({ name: z.string() }).optional(),
});

const checkSuitePayload = z.object({
  action: z.string(),
  repository: z.object({ full_name: z.string() }),
  check_suite: z.object({
    head_branch: z.string().nullable().optional(),
    conclusion: z.string().nullable().optional(),
    pull_requests: z.array(z.object({ number: z.number().int() })).optional(),
  }),
});

const reviewPayload = z.object({
  action: z.string(),
  repository: z.object({ full_name: z.string() }),
  review: z.object({ state: z.string() }),
  pull_request: z.object({ number: z.number().int() }),
});

const pullPayload = z.object({
  action: z.string(),
  repository: z.object({ full_name: z.string() }),
  pull_request: z.object({
    number: z.number().int(),
    merged: z.boolean().optional(),
  }),
});

export interface GithubWebhookInput {
  rawBody: Buffer;
  signature: string | undefined;
  deliveryId: string | undefined;
  eventName: string | undefined;
}

export interface GithubWebhookResult {
  status: 200 | 400 | 401 | 500;
  body: Record<string, unknown>;
}

function inProgress(): GithubWebhookResult {
  return { status: 500, body: { ok: false, error: "delivery in progress" } };
}

function lostClaim(): GithubWebhookResult {
  return { status: 200, body: { ok: true, disposition: "lost_claim" } };
}

export async function handleGithubWebhook(
  deps: WebhookDependencies,
  input: GithubWebhookInput,
): Promise<GithubWebhookResult> {
  if (!verifyGithubSignature(input.rawBody, input.signature, deps.webhookSecret)) {
    return { status: 401, body: { ok: false, error: "invalid signature" } };
  }
  const deliveryId = input.deliveryId?.trim();
  if (!deliveryId || deliveryId.length > 256) {
    return { status: 400, body: { ok: false, error: "missing X-GitHub-Delivery" } };
  }
  const eventName = input.eventName?.trim() || "unknown";

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody.toString("utf8")) as unknown;
  } catch {
    const claim = await deps.store.claimDelivery({
      deliveryId,
      eventName,
      action: null,
      repo: null,
    });
    if (claim.outcome === "duplicate")
      return { status: 200, body: { ok: true, disposition: "duplicate" } };
    if (claim.outcome === "in_progress") return inProgress();
    const finished = await deps.store.finishDelivery(
      deliveryId,
      "processed",
      "invalid_json",
      claim.generation,
    );
    if (!finished) return lostClaim();
    return { status: 200, body: { ok: true, disposition: "invalid_json" } };
  }

  const action = readAction(payload);
  const repo = readRepo(payload);
  const claim = await deps.store.claimDelivery({ deliveryId, eventName, action, repo });
  if (claim.outcome === "duplicate") {
    return { status: 200, body: { ok: true, disposition: "duplicate" } };
  }
  // A fresh claim belongs to another request. 500 asks GitHub to retry.
  // A finished winner then looks like a duplicate; a crashed winner is stale
  // and the retry can take the row.
  if (claim.outcome === "in_progress") return inProgress();

  try {
    const result = await dispatch(deps, eventName, payload, repo);
    const finished = await deps.store.finishDelivery(
      deliveryId,
      "processed",
      result.disposition,
      claim.generation,
    );
    if (!finished) return lostClaim();
    return { status: 200, body: { ok: true, ...result.body, disposition: result.disposition } };
  } catch (error) {
    deps.logger.error("webhook handler failed", {
      deliveryId,
      eventName,
      message: error instanceof Error ? error.message : "unknown error",
    });
    const finished = await deps.store.finishDelivery(
      deliveryId,
      "failed",
      "error",
      claim.generation,
    );
    if (!finished) return lostClaim();
    return { status: 500, body: { ok: false, error: "webhook handler failed" } };
  }
}

async function dispatch(
  deps: WebhookDependencies,
  eventName: string,
  payload: unknown,
  repo: string | null,
): Promise<{ disposition: string; body: Record<string, unknown> }> {
  if (!repo || !deps.allowedRepos.has(repo)) {
    return { disposition: "ignored_repo", body: {} };
  }
  if (eventName === "issues") return handleIssues(deps, payload, repo);
  if (eventName === "check_suite") return handleCheckSuite(deps, payload, repo);
  if (eventName === "pull_request_review") return handleReview(deps, payload, repo);
  if (eventName === "pull_request") return handlePull(deps, payload, repo);
  return { disposition: "ignored_event", body: {} };
}

async function handleIssues(
  deps: WebhookDependencies,
  payload: unknown,
  repo: string,
): Promise<{ disposition: string; body: Record<string, unknown> }> {
  const parsed = labeledPayload.safeParse(payload);
  if (!parsed.success) return { disposition: "ignored_payload", body: {} };
  if (parsed.data.action !== "labeled") return { disposition: "ignored_action", body: {} };
  if (parsed.data.issue.pull_request !== undefined)
    return { disposition: "ignored_pull_request", body: {} };
  if (parsed.data.label?.name !== deps.triggerLabel)
    return { disposition: "ignored_label", body: {} };
  const installationId = parsed.data.installation?.id;
  if (!installationId) return { disposition: "ignored_missing_installation", body: {} };

  const issueNumber = parsed.data.issue.number;
  const active = await deps.store.findActiveTask(repo, issueNumber);
  if (active) {
    await deps.store.appendEvent({
      taskId: active.id,
      type: "duplicate_label",
      message: "Label applied while a task is already active",
      payload: { issueNumber },
      createdAt: deps.clock.now(),
    });
    return { disposition: "already_active", body: { taskId: active.id } };
  }

  const now = deps.clock.now();
  const attemptGroup = await deps.store.nextAttemptGroup(repo, issueNumber);
  try {
    const task = await deps.store.createTask({
      id: randomUUID(),
      repo,
      issueNumber,
      attemptGroup,
      branch: branchName(issueNumber),
      installationId,
      issueTitle: parsed.data.issue.title ?? "",
      issueBody: parsed.data.issue.body ?? "",
      createdAt: now,
    });
    await deps.store.appendEvent({
      taskId: task.id,
      type: "queued",
      message: `Queued ${repo}#${issueNumber} on ${task.branch}`,
      payload: { attemptGroup, idempotencyKey: task.idempotencyKey },
      createdAt: now,
    });
    await deps.enqueue(task);
    return { disposition: "queued", body: { taskId: task.id } };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await deps.store.findActiveTask(repo, issueNumber);
    return { disposition: "already_active", body: { taskId: raced?.id ?? null } };
  }
}

async function handleCheckSuite(
  deps: WebhookDependencies,
  payload: unknown,
  repo: string,
): Promise<{ disposition: string; body: Record<string, unknown> }> {
  const parsed = checkSuitePayload.safeParse(payload);
  if (!parsed.success || parsed.data.action !== "completed") {
    return { disposition: "ignored_action", body: {} };
  }
  const prNumber = parsed.data.check_suite.pull_requests?.[0]?.number ?? null;
  const result = await applyCheckSuite(deps, {
    repo,
    branch: parsed.data.check_suite.head_branch ?? null,
    prNumber,
    conclusion: parsed.data.check_suite.conclusion ?? null,
  });
  return { disposition: result.disposition, body: { taskId: result.task?.id ?? null } };
}

async function handleReview(
  deps: WebhookDependencies,
  payload: unknown,
  repo: string,
): Promise<{ disposition: string; body: Record<string, unknown> }> {
  const parsed = reviewPayload.safeParse(payload);
  if (!parsed.success || parsed.data.action !== "submitted") {
    return { disposition: "ignored_action", body: {} };
  }
  const result = await applyReview(deps, {
    repo,
    prNumber: parsed.data.pull_request.number,
    state: parsed.data.review.state,
  });
  return { disposition: result.disposition, body: { taskId: result.task?.id ?? null } };
}

async function handlePull(
  deps: WebhookDependencies,
  payload: unknown,
  repo: string,
): Promise<{ disposition: string; body: Record<string, unknown> }> {
  const parsed = pullPayload.safeParse(payload);
  if (!parsed.success || parsed.data.action !== "closed") {
    return { disposition: "ignored_action", body: {} };
  }
  const result = await applyPullRequestClosed(deps, {
    repo,
    prNumber: parsed.data.pull_request.number,
    merged: parsed.data.pull_request.merged === true,
  });
  return { disposition: result.disposition, body: { taskId: result.task?.id ?? null } };
}

function readAction(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("action" in payload)) return null;
  return typeof payload.action === "string" ? payload.action : null;
}

function readRepo(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("repository" in payload)) return null;
  const repository = payload.repository;
  if (typeof repository !== "object" || repository === null || !("full_name" in repository))
    return null;
  return typeof repository.full_name === "string" ? normalizeRepo(repository.full_name) : null;
}
