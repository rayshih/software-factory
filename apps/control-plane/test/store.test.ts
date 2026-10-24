import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "../src/github/errors.js";
import { branchName } from "../src/tasks/ids.js";
import { createTestStore, fixedClock } from "./helpers.js";

describe("task store", () => {
  it("rejects a second active task for the same issue and appends events only", async () => {
    const store = await createTestStore();
    const now = fixedClock.now();
    const first = await store.createTask({
      id: randomUUID(),
      repo: "rayshih/sf-demo-todo-api",
      issueNumber: 3,
      attemptGroup: 1,
      branch: branchName(3),
      installationId: 1,
      issueTitle: "one",
      issueBody: "",
      createdAt: now,
    });
    await expect(
      store.createTask({
        id: randomUUID(),
        repo: "rayshih/sf-demo-todo-api",
        issueNumber: 3,
        attemptGroup: 2,
        branch: branchName(3),
        installationId: 1,
        issueTitle: "two",
        issueBody: "",
        createdAt: now,
      }),
    ).rejects.toSatisfy((error: unknown) => isUniqueViolation(error));

    await store.updateTask(first.id, { status: "failed", failureCategory: "idle_without_pr" });
    const second = await store.createTask({
      id: randomUUID(),
      repo: "rayshih/sf-demo-todo-api",
      issueNumber: 3,
      attemptGroup: await store.nextAttemptGroup("rayshih/sf-demo-todo-api", 3),
      branch: branchName(3),
      installationId: 1,
      issueTitle: "retry",
      issueBody: "",
      createdAt: now,
    });
    expect(second.attemptGroup).toBe(2);
    expect(second.branch).toBe("factory/issue-3");
    expect(second.idempotencyKey).toBe("rayshih/sf-demo-todo-api#3#2");

    await store.appendEvent({ taskId: second.id, type: "queued", message: "queued" });
    await store.appendEvent({ taskId: second.id, type: "queued", message: "again" });
    const events = await store.listEvents(second.id);
    expect(events.map((event) => event.message)).toEqual(["queued", "again"]);
    expect("updateEvent" in store).toBe(false);
    expect("deleteEvent" in store).toBe(false);
  });

  it("records a delivery once and lets a failed delivery be claimed again", async () => {
    const store = await createTestStore();
    expect(
      await store.claimDelivery({
        deliveryId: "abc",
        eventName: "issues",
        action: "labeled",
        repo: "rayshih/sf-demo-todo-api",
      }),
    ).toBe("process");
    await store.finishDelivery("abc", "processed", "queued");
    expect(
      await store.claimDelivery({
        deliveryId: "abc",
        eventName: "issues",
        action: "labeled",
        repo: "rayshih/sf-demo-todo-api",
      }),
    ).toBe("duplicate");

    expect(
      await store.claimDelivery({
        deliveryId: "retry-me",
        eventName: "issues",
        action: "labeled",
        repo: "rayshih/sf-demo-todo-api",
      }),
    ).toBe("process");
    await store.finishDelivery("retry-me", "failed", "error");
    expect(
      await store.claimDelivery({
        deliveryId: "retry-me",
        eventName: "issues",
        action: "labeled",
        repo: "rayshih/sf-demo-todo-api",
      }),
    ).toBe("process");
  });
});
