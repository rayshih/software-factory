import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { applyMigrations } from "../src/db/migrate.js";
import * as schema from "../src/db/schema.js";
import type { AppDatabase } from "../src/db/client.js";
import { createTaskStore } from "../src/store/drizzle-store.js";
import type { TaskStore } from "../src/store/types.js";
import { FakeGitHub } from "../src/github/fake-github.js";
import { StubAgentRuntime } from "../src/agent/stub.js";
import type { AgentRunResult } from "../src/agent/types.js";
import { silentLogger } from "../src/log.js";
import type { Clock } from "../src/clock.js";
import { parseAllowedRepos } from "../src/config.js";
import type { WebhookDependencies } from "../src/pipeline.js";
import { signGithubBody } from "../src/github/signature.js";
import { createApp } from "../src/app.js";

export const WEBHOOK_SECRET = "test-webhook-secret";
export const DEMO_REPO = "rayshih/sf-demo-todo-api";

export const fixedClock: Clock = {
  now: () => new Date("2026-10-26T00:00:00.000Z"),
};

export async function createTestStore(): Promise<TaskStore> {
  const client = new PGlite();
  await applyMigrations({
    async exec(sql) {
      await client.exec(sql);
    },
    async query<T extends Record<string, unknown>>(sql: string) {
      const result = await client.query<T>(sql);
      return result.rows;
    },
  });
  const db = drizzle(client, { schema });
  return createTaskStore(db as unknown as AppDatabase);
}

export function zeroResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    sessionStatus: "stub",
    summary: "scripted",
    files: [],
    costUsd: "0.000000",
    tokens: 0,
    interventions: 0,
    humanInterventionMinutes: 0,
    ...overrides,
  };
}

export async function createDeps(options?: {
  agent?: WebhookDependencies["agent"];
  allowedRepos?: ReadonlySet<string>;
}): Promise<{ deps: WebhookDependencies; github: FakeGitHub; enqueued: string[] }> {
  const store = await createTestStore();
  const github = new FakeGitHub();
  github.seedRepo(DEMO_REPO);
  github.seedToken(4242);
  const enqueued: string[] = [];
  const deps: WebhookDependencies = {
    store,
    github,
    agent: options?.agent ?? new StubAgentRuntime(),
    enqueue: async (task, _options) => {
      enqueued.push(task.id);
      return { id: `run_${enqueued.length}` };
    },
    allowedRepos: options?.allowedRepos ?? parseAllowedRepos(undefined),
    baseBranch: "main",
    clock: fixedClock,
    logger: silentLogger,
    webhookSecret: WEBHOOK_SECRET,
    triggerLabel: "factory:run",
  };
  return { deps, github, enqueued };
}

export async function postGithub(
  deps: WebhookDependencies,
  eventName: string,
  deliveryId: string,
  payload: unknown,
  secret = WEBHOOK_SECRET,
): Promise<Response> {
  const raw = Buffer.from(JSON.stringify(payload));
  const app = createApp(deps);
  return app.request("/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": eventName,
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": signGithubBody(raw, secret),
    },
    body: raw,
  });
}

export function labeledPayload(overrides?: {
  repo?: string;
  label?: string;
  action?: string;
  issueNumber?: number;
  installationId?: number | null;
  pullRequest?: boolean;
}) {
  const installationId = overrides?.installationId === undefined ? 4242 : overrides.installationId;
  return {
    action: overrides?.action ?? "labeled",
    installation: installationId === null ? undefined : { id: installationId },
    repository: { full_name: overrides?.repo ?? "RayShih/sf-demo-todo-api" },
    issue: {
      number: overrides?.issueNumber ?? 7,
      title: "Fix the bug",
      body: "Steps to reproduce",
      ...(overrides?.pullRequest ? { pull_request: { url: "https://example.test" } } : {}),
    },
    label: { name: overrides?.label ?? "factory:run" },
  };
}
