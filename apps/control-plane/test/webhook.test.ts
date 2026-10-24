import { describe, expect, it } from "vitest";
import { parseAllowedRepos } from "../src/config.js";
import { branchName, idempotencyKey } from "../src/tasks/ids.js";
import { createDeps, labeledPayload, postGithub } from "./helpers.js";

describe("label and allowlist filtering", () => {
  it("defaults the allowlist to the demo repository", () => {
    expect(parseAllowedRepos(undefined).has("rayshih/sf-demo-todo-api")).toBe(true);
    expect(parseAllowedRepos("Other/Repo").has("other/repo")).toBe(true);
    expect(parseAllowedRepos("").size).toBe(0);
  });

  it("queues a factory:run label on an allowlisted repo", async () => {
    const { deps, enqueued } = await createDeps();
    const response = await postGithub(deps, "issues", "delivery-queue", labeledPayload());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { disposition: string; taskId: string };
    expect(body.disposition).toBe("queued");
    expect(enqueued).toEqual([body.taskId]);

    const task = await deps.store.getTask(body.taskId);
    expect(task?.repo).toBe("rayshih/sf-demo-todo-api");
    expect(task?.issueNumber).toBe(7);
    expect(task?.status).toBe("queued");
    expect(task?.branch).toBe("factory/issue-7");
    expect(task?.idempotencyKey).toBe(idempotencyKey("rayshih/sf-demo-todo-api", 7, 1));
    expect(task?.branch).toBe(branchName(7));
    expect(task?.costUsd).toBe("0.000000");
    expect(task?.interventions).toBe(0);
  });

  it("ignores other labels, other events, other repos, and pull requests", async () => {
    const { deps, enqueued } = await createDeps();
    const cases = [
      ["issues", "d-label", labeledPayload({ label: "bug" }), "ignored_label"],
      ["issues", "d-case", labeledPayload({ label: "Factory:run" }), "ignored_label"],
      ["issues", "d-open", labeledPayload({ action: "opened" }), "ignored_action"],
      ["issues", "d-repo", labeledPayload({ repo: "rayshih/other" }), "ignored_repo"],
      ["issues", "d-pr", labeledPayload({ pullRequest: true }), "ignored_pull_request"],
      [
        "push",
        "d-push",
        { repository: { full_name: "rayshih/sf-demo-todo-api" } },
        "ignored_event",
      ],
    ] as const;

    for (const [event, delivery, payload, disposition] of cases) {
      const response = await postGithub(deps, event, delivery, payload);
      expect(response.status).toBe(200);
      expect(((await response.json()) as { disposition: string }).disposition).toBe(disposition);
    }
    expect(enqueued).toEqual([]);
    expect(await deps.store.listTasks()).toEqual([]);
  });
});

describe("delivery dedupe", () => {
  it("does not create a second task or enqueue twice for the same delivery id", async () => {
    const { deps, enqueued } = await createDeps();
    const payload = labeledPayload();
    const first = await postGithub(deps, "issues", "same-delivery", payload);
    const second = await postGithub(deps, "issues", "same-delivery", payload);
    expect(((await first.json()) as { disposition: string }).disposition).toBe("queued");
    expect(((await second.json()) as { disposition: string }).disposition).toBe("duplicate");
    expect(enqueued).toHaveLength(1);
    expect(await deps.store.listTasks()).toHaveLength(1);
  });

  it("keeps one active task when a new delivery labels the same issue again", async () => {
    const { deps, enqueued } = await createDeps();
    await postGithub(deps, "issues", "delivery-a", labeledPayload());
    const again = await postGithub(deps, "issues", "delivery-b", labeledPayload());
    expect(((await again.json()) as { disposition: string }).disposition).toBe("already_active");
    expect(enqueued).toHaveLength(1);
    expect(await deps.store.listTasks()).toHaveLength(1);
  });

  it("returns 500 while another caller holds a fresh claim and does not enqueue", async () => {
    const { deps, enqueued } = await createDeps();
    expect(
      await deps.store.claimDelivery({
        deliveryId: "held",
        eventName: "issues",
        action: "labeled",
        repo: "rayshih/sf-demo-todo-api",
      }),
    ).toMatchObject({ outcome: "process" });

    const response = await postGithub(deps, "issues", "held", labeledPayload());
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toBe("delivery in progress");
    expect(enqueued).toEqual([]);
    expect(await deps.store.listTasks()).toHaveLength(0);
    expect((await deps.store.getDelivery("held"))?.status).toBe("processing");
  });

  it("does not finish a fresh claim when a redelivery body is not json", async () => {
    const { deps } = await createDeps();
    await deps.store.claimDelivery({
      deliveryId: "held-json",
      eventName: "issues",
      action: null,
      repo: null,
    });
    const { signGithubBody } = await import("../src/github/signature.js");
    const { createApp } = await import("../src/app.js");
    const raw = Buffer.from("not-json");
    const response = await createApp(deps).request("/webhooks/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-github-delivery": "held-json",
        "x-hub-signature-256": signGithubBody(raw, deps.webhookSecret),
      },
      body: raw,
    });
    expect(response.status).toBe(500);
    expect((await deps.store.getDelivery("held-json"))?.status).toBe("processing");
    expect((await deps.store.getDelivery("held-json"))?.disposition).toBe("processing");
  });

  it("returns 400 when the delivery id is missing and does not record a task", async () => {
    const { deps } = await createDeps();
    const { signGithubBody } = await import("../src/github/signature.js");
    const { createApp } = await import("../src/app.js");
    const raw = Buffer.from(JSON.stringify(labeledPayload()));
    const response = await createApp(deps).request("/webhooks/github", {
      method: "POST",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": signGithubBody(raw, deps.webhookSecret),
      },
      body: raw,
    });
    expect(response.status).toBe(400);
    expect(await deps.store.listTasks()).toHaveLength(0);
  });
});
