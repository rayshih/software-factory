import type { AgentRuntime } from "./agent/types.js";
import type { Clock } from "./clock.js";
import type { GitHubClient } from "./github/client.js";
import type { Logger } from "./log.js";
import type { TaskRecord, TaskStore } from "./store/types.js";

export interface PipelineDependencies {
  store: TaskStore;
  github: GitHubClient;
  agent: AgentRuntime;
  enqueue: (task: TaskRecord) => Promise<{ id: string }>;
  allowedRepos: ReadonlySet<string>;
  baseBranch: string;
  clock: Clock;
  logger: Logger;
}

export interface WebhookDependencies extends PipelineDependencies {
  webhookSecret: string;
  triggerLabel: string;
}
