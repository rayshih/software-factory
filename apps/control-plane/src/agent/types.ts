import type { FileChange } from "../github/content-hash.js";

/**
 * Session status describes the agent runtime only.
 * `idle` means the session stopped waiting for input. It is not a completed factory task.
 * Completion is a pull request plus CI, decided by the control plane.
 */
export type AgentSessionStatus = "idle" | "error" | "terminated" | "stub";

export interface AgentRunRequest {
  taskId: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  branch: string;
  baseBranch: string;
  attempt: number;
  installationToken: string;
}

export interface AgentRunResult {
  sessionStatus: AgentSessionStatus;
  summary: string;
  /** File edits the control plane should commit. Managed agents push from the sandbox and return []. */
  files: FileChange[];
  costUsd: string;
  tokens: number;
  interventions: number;
  humanInterventionMinutes: number;
}

export interface AgentRuntime {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

export const NOT_TASK_COMPLETION = "This session status is not task completion.";
