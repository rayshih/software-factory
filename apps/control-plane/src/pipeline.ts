import type { AgentRuntime } from "./agent/types.js";
import type { Clock } from "./clock.js";
import type { GitHubClient } from "./github/client.js";
import type { Logger } from "./log.js";
import type { TaskRecord, TaskStore } from "./store/types.js";

export interface PipelineDependencies {
  store: TaskStore;
  github: GitHubClient;
  agent: AgentRuntime;
  /** Submit once per key and return the existing run when the same key is retried. */
  enqueue: (task: TaskRecord, options: { idempotencyKey: string }) => Promise<{ id: string }>;
  allowedRepos: ReadonlySet<string>;
  baseBranch: string;
  clock: Clock;
  logger: Logger;
  /** How long a run owns the task before another worker may take it. Default 60s. */
  leaseDurationMs?: number;
  /** How often the owner extends the lease while the agent runs. Default 20s. */
  leaseRenewIntervalMs?: number;
}

export interface WebhookDependencies extends PipelineDependencies {
  webhookSecret: string;
  triggerLabel: string;
}
