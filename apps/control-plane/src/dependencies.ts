import { tasks } from "@trigger.dev/sdk";
import type { runIssue } from "../trigger/run-issue.js";
import {
  AnthropicManagedAgentRuntime,
  createSdkManagedAgentClient,
} from "./agent/anthropic-managed.js";
import { StubAgentRuntime } from "./agent/stub.js";
import { systemClock } from "./clock.js";
import { loadServerConfig, loadSharedConfig, type SharedConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { createOctokitGitHub } from "./github/octokit-github.js";
import { consoleLogger } from "./log.js";
import type { PipelineDependencies, WebhookDependencies } from "./pipeline.js";
import type { TaskRecord } from "./store/types.js";
import { triggerIdempotencyKey } from "./tasks/ids.js";

let pipelinePromise: Promise<PipelineDependencies> | undefined;

export function getPipeline(env: NodeJS.ProcessEnv = process.env): Promise<PipelineDependencies> {
  pipelinePromise ??= createPipeline(loadSharedConfig(env));
  return pipelinePromise;
}

export async function createWebhookDependencies(
  env: NodeJS.ProcessEnv = process.env,
): Promise<WebhookDependencies> {
  const server = loadServerConfig(env);
  const pipeline = await getPipeline(env);
  return {
    ...pipeline,
    webhookSecret: server.webhookSecret,
    triggerLabel: server.triggerLabel,
  };
}

async function createPipeline(config: SharedConfig): Promise<PipelineDependencies> {
  const database = await openDatabase(config.databaseUrl);
  const github = createOctokitGitHub({
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
  });
  const agent = config.anthropicApiKey
    ? new AnthropicManagedAgentRuntime(
        createSdkManagedAgentClient({
          apiKey: config.anthropicApiKey,
          model: config.anthropicModel,
          environmentId: config.anthropicEnvironmentId,
        }),
        config.agentTimeoutMs,
      )
    : new StubAgentRuntime();

  return {
    store: database.store,
    github,
    agent,
    allowedRepos: config.allowedRepos,
    baseBranch: config.baseBranch,
    clock: systemClock,
    logger: consoleLogger,
    enqueue: (task) => enqueueRunIssue(task),
  };
}

async function enqueueRunIssue(task: TaskRecord): Promise<{ id: string }> {
  if (!process.env.TRIGGER_SECRET_KEY?.trim()) {
    throw new Error("TRIGGER_SECRET_KEY is not set");
  }
  const handle = await tasks.trigger<typeof runIssue>(
    "run-issue",
    { taskId: task.id },
    {
      idempotencyKey: triggerIdempotencyKey(task),
      concurrencyKey: task.repo,
    },
  );
  return { id: handle.id };
}
