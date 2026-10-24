import Anthropic from "@anthropic-ai/sdk";
import {
  NOT_TASK_COMPLETION,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentRuntime,
} from "./types.js";
import { usageToTracking, type UsageSnapshot } from "./usage.js";

export interface ManagedAgentSettlement {
  status: "idle" | "error" | "terminated";
  stopReason: string | null;
  errorMessage: string | null;
  costUsd: string;
  tokens: number;
}

/**
 * Narrow client so the session loop can be tested without the network.
 * `createSdkManagedAgentClient` is the real Claude Managed Agents implementation
 * (`client.beta.agents` / `client.beta.sessions` in @anthropic-ai/sdk).
 */
export interface ManagedAgentClient {
  run(request: AgentRunRequest, signal: AbortSignal): Promise<ManagedAgentSettlement>;
}

const SYSTEM_PROMPT = `You are the coding agent for Software Factory.
The repository is mounted at /workspace/repo and is already checked out on the task branch.
Do the issue's work on that branch. Commit and push to origin.
Do not open a pull request. Do not merge. Do not change repository settings, rulesets, or GitHub Actions permissions.
Stop after the commits are pushed. Going idle is not completion: the control plane opens the pull request and a human reviews it.`;

export class AnthropicManagedAgentRuntime implements AgentRuntime {
  constructor(
    private readonly client: ManagedAgentClient,
    private readonly timeoutMs: number,
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let settlement: ManagedAgentSettlement;
    try {
      settlement = await this.client.run(request, signal);
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      settlement = {
        status: "error",
        stopReason: null,
        errorMessage: timedOut
          ? "Managed agent session timed out"
          : error instanceof Error
            ? error.message.slice(0, 500)
            : "Managed agent session failed",
        costUsd: "0.000000",
        tokens: 0,
      };
    }
    const detail = settlement.errorMessage ?? settlement.stopReason ?? settlement.status;
    return {
      sessionStatus: settlement.status,
      summary: `Managed agent session ${settlement.status} (${detail}). ${NOT_TASK_COMPLETION}`,
      files: [],
      costUsd: settlement.costUsd,
      tokens: settlement.tokens,
      interventions: 0,
      humanInterventionMinutes: 0,
    };
  }
}

export function createSdkManagedAgentClient(options: {
  apiKey: string;
  model: string;
  environmentId: string | null;
}): ManagedAgentClient {
  const client = new Anthropic({ apiKey: options.apiKey });
  return {
    async run(request, signal) {
      const environmentId =
        options.environmentId ??
        (
          await client.beta.environments.create(
            {
              name: "software-factory",
              config: {
                type: "cloud",
                networking: {
                  type: "limited",
                  allow_package_managers: true,
                  allowed_hosts: [
                    "github.com",
                    "api.github.com",
                    "codeload.github.com",
                    "objects.githubusercontent.com",
                  ],
                },
              },
            },
            { signal },
          )
        ).id;

      const agent = await client.beta.agents.create(
        {
          name: `factory-${request.taskId}`,
          model: options.model,
          system: SYSTEM_PROMPT,
          metadata: {
            task_id: request.taskId,
            repo: request.repo,
          },
          tools: [
            {
              type: "agent_toolset_20260401",
              default_config: { permission_policy: { type: "always_allow" } },
              configs: [
                { name: "web_fetch", enabled: false },
                { name: "web_search", enabled: false },
              ],
            },
          ],
        },
        { signal },
      );

      const session = await client.beta.sessions.create(
        {
          agent: agent.id,
          environment_id: environmentId,
          title: `${request.repo}#${request.issueNumber}`,
          metadata: {
            task_id: request.taskId,
            repo: request.repo.slice(0, 512),
            issue: String(request.issueNumber),
          },
          resources: [
            {
              type: "github_repository",
              url: `https://github.com/${request.repo}`,
              mount_path: "/workspace/repo",
              authorization_token: request.installationToken,
              checkout: { type: "branch", name: request.branch },
            },
          ],
        },
        { signal },
      );

      // Open the stream before sending work so events are not missed.
      const stream = await client.beta.sessions.events.stream(session.id, {}, { signal });
      await client.beta.sessions.events.send(
        session.id,
        {
          events: [
            {
              type: "user.message",
              content: [{ type: "text", text: userPrompt(request) }],
            },
          ],
        },
        { signal },
      );

      let latest: UsageSnapshot | null = null;
      let settlement: ManagedAgentSettlement | null = null;
      for await (const event of stream) {
        if (event.type === "session.usage") {
          latest = event.usage;
        } else if (event.type === "session.status_idle") {
          settlement = {
            status: "idle",
            stopReason: event.stop_reason.type,
            errorMessage: null,
            ...usageToTracking(latest),
          };
          break;
        } else if (event.type === "session.error") {
          settlement = {
            status: "error",
            stopReason: null,
            errorMessage: errorText(event.error),
            ...usageToTracking(latest),
          };
          break;
        } else if (event.type === "session.status_terminated") {
          settlement = {
            status: "terminated",
            stopReason: "terminated",
            errorMessage: null,
            ...usageToTracking(latest),
          };
          break;
        }
      }

      const retrieved = await client.beta.sessions.retrieve(session.id, {}, { signal });
      const usage = usageToTracking(retrieved.usage ?? latest);
      if (!settlement) {
        if (retrieved.status === "idle") {
          settlement = { status: "idle", stopReason: "idle", errorMessage: null, ...usage };
        } else if (retrieved.status === "terminated") {
          settlement = {
            status: "terminated",
            stopReason: "terminated",
            errorMessage: null,
            ...usage,
          };
        } else {
          settlement = {
            status: "error",
            stopReason: retrieved.status,
            errorMessage: "Managed agent stream ended before the session settled",
            ...usage,
          };
        }
      }
      return { ...settlement, costUsd: usage.costUsd, tokens: usage.tokens };
    },
  };
}

function userPrompt(request: AgentRunRequest): string {
  return [
    `Repository: https://github.com/${request.repo}`,
    `Branch: ${request.branch} (checked out at /workspace/repo, based on ${request.baseBranch})`,
    `Attempt: ${request.attempt}`,
    `Issue #${request.issueNumber}: ${request.issueTitle}`,
    "",
    request.issueBody || "(no issue body)",
    "",
    "Commit and push to that branch. Do not open a pull request and do not merge.",
  ].join("\n");
}

function errorText(error: object): string {
  if ("message" in error && typeof error.message === "string" && error.message.length > 0) {
    return error.message.slice(0, 500);
  }
  if ("type" in error && typeof error.type === "string") return error.type;
  return "session error";
}
