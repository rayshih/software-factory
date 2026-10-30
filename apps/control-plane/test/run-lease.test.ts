import { describe, expect, it } from "vitest";
import { StubAgentRuntime } from "../src/agent/stub.js";
import type { AgentRunRequest, AgentRunResult } from "../src/agent/types.js";
import { LeaseHeldError, StaleRunError } from "../src/store/types.js";
import { executeRunIssue } from "../src/tasks/run-issue.js";
import { createDeps, zeroResult } from "./helpers.js";

const fix = [{ path: "src/fix.ts", content: "export const fixed = true;\n" }];

class GateAgent extends StubAgentRuntime {
  entered = 0;
  release: (() => void) | undefined;

  constructor(private readonly wait: boolean) {
    super(zeroResult({ sessionStatus: "idle", files: fix, summary: "pushed the fix" }));
  }

  override async run(request: AgentRunRequest): Promise<AgentRunResult> {
    this.entered += 1;
    if (this.wait && this.entered === 1) {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }
    return super.run(request);
  }
}

class Clock {
  current = new Date("2026-10-26T00:00:00.000Z");
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe("run lease", () => {
  it("lets only one of two simultaneous invocations own the task", async () => {
    const agent = new GateAgent(true);
    const { deps } = await createDeps({ agent });
    const task = await queue(deps);
    const first = executeRunIssue(deps, { taskId: task.id });
    await waitFor(() => agent.entered === 1);
    const second = executeRunIssue(deps, { taskId: task.id });
    await expect(second).rejects.toBeInstanceOf(LeaseHeldError);
    agent.release?.();
    const done = await first;
    expect(done.status).toBe("pr_opened");
    expect(done.attempts).toBe(1);
    expect(agent.entered).toBe(1);
  });

  it("lets a second worker take over an expired lease", async () => {
    const clock = new Clock();
    const agent = new GateAgent(true);
    const { deps, github } = await createDeps({ agent });
    deps.clock = clock;
    deps.leaseDurationMs = 1_000;
    deps.leaseRenewIntervalMs = 0;
    const task = await queue(deps);
    const first = executeRunIssue(deps, { taskId: task.id });
    await waitFor(() => agent.entered === 1);
    clock.advance(1_001);
    const second = await executeRunIssue(deps, { taskId: task.id });
    expect(second.status).toBe("pr_opened");
    expect(second.attempts).toBe(2);
    expect(github.pushesCreated).toBe(1);
    agent.release?.();
    await expect(first).rejects.toBeInstanceOf(StaleRunError);
  });

  it("rejects a stale worker's completion after the lease was taken", async () => {
    const clock = new Clock();
    const agent = new GateAgent(true);
    const { deps } = await createDeps({ agent });
    deps.clock = clock;
    deps.leaseDurationMs = 1_000;
    deps.leaseRenewIntervalMs = 0;
    const task = await queue(deps);
    const running = executeRunIssue(deps, { taskId: task.id });
    await waitFor(() => agent.entered === 1);
    const owned = await deps.store.getTask(task.id);
    clock.advance(1_001);
    const taken = await deps.store.claimRun(task.id, {
      runId: "takeover-run",
      expectedStatus: "running",
      leaseExpiresAt: new Date(clock.now().getTime() + 60_000),
      now: clock.now(),
    });
    expect(taken?.runId).toBe("takeover-run");
    agent.release?.();
    await expect(running).rejects.toBeInstanceOf(StaleRunError);
    const after = await deps.store.getTask(task.id);
    expect(after?.runId).toBe("takeover-run");
    expect(after?.status).toBe("running");
    expect(after?.prNumber).toBeNull();
    expect(owned?.runId).not.toBe("takeover-run");
  });

  it("renews the lease while the agent is still running", async () => {
    const agent = new GateAgent(true);
    const { deps } = await createDeps({ agent });
    deps.leaseDurationMs = 5_000;
    deps.leaseRenewIntervalMs = 15;
    let renewals = 0;
    const renewRun = deps.store.renewRun.bind(deps.store);
    deps.store.renewRun = async (...args) => {
      renewals += 1;
      return renewRun(...args);
    };
    const task = await queue(deps);
    const running = executeRunIssue(deps, { taskId: task.id });
    await waitFor(() => agent.entered === 1);
    await waitFor(() => renewals >= 1);
    agent.release?.();
    await running;
    expect(renewals).toBeGreaterThan(0);
  });
});

async function queue(deps: Awaited<ReturnType<typeof createDeps>>["deps"]) {
  return deps.store.createTask({
    id: crypto.randomUUID(),
    repo: "rayshih/sf-demo-todo-api",
    issueNumber: 7,
    attemptGroup: 1,
    branch: "factory/issue-7",
    installationId: 4242,
    issueTitle: "Fix the bug",
    issueBody: "please fix",
    createdAt: deps.clock.now(),
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting");
}
