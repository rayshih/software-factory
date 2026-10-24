import {
  NOT_TASK_COMPLETION,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentRuntime,
} from "./types.js";

/**
 * Offline stand-in for tests and for a worker booted without ANTHROPIC_API_KEY.
 * Reports zero cost. The production path is AnthropicManagedAgentRuntime.
 */
export class StubAgentRuntime implements AgentRuntime {
  constructor(private readonly overrides: Partial<AgentRunResult> = {}) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    return {
      sessionStatus: "stub",
      summary: `Stub agent runtime did not call Anthropic for ${request.repo}#${request.issueNumber}. ${NOT_TASK_COMPLETION}`,
      files: [],
      costUsd: "0.000000",
      tokens: 0,
      interventions: 0,
      humanInterventionMinutes: 0,
      ...this.overrides,
    };
  }
}
