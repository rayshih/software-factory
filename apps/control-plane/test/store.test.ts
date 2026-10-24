import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../src/db/migrate.js";
import * as schema from "../src/db/schema.js";
import type { AppDatabase } from "../src/db/client.js";
import { isUniqueViolation } from "../src/github/errors.js";
import { createTaskStore, DELIVERY_CLAIM_STALE_AFTER } from "../src/store/drizzle-store.js";
import type { TaskStore } from "../src/store/types.js";
import { branchName } from "../src/tasks/ids.js";
import { createTestStore, fixedClock } from "./helpers.js";

const delivery = {
  eventName: "issues",
  action: "labeled" as string | null,
  repo: "rayshih/sf-demo-todo-api",
};

async function createClaimStore(): Promise<{ store: TaskStore; client: PGlite }> {
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
  return { store: createTaskStore(db as unknown as AppDatabase), client };
}

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

  it("lets only one concurrent claim win while the other claim is fresh", async () => {
    const { store } = await createClaimStore();
    const input = { deliveryId: "same-delivery", ...delivery };
    const results = await Promise.all([store.claimDelivery(input), store.claimDelivery(input)]);
    expect(results.filter((result) => result === "process")).toHaveLength(1);
    expect(results.filter((result) => result === "in_progress")).toHaveLength(1);

    expect(await store.claimDelivery(input)).toBe("in_progress");
  });

  it("reclaims a processing delivery after the claim goes stale", async () => {
    const { store, client } = await createClaimStore();
    const input = { deliveryId: "abandoned", ...delivery };
    expect(await store.claimDelivery(input)).toBe("process");
    await client.exec(
      `UPDATE webhook_deliveries SET claimed_at = now() - interval '${DELIVERY_CLAIM_STALE_AFTER}' - interval '1 second' WHERE delivery_id = 'abandoned'`,
    );
    expect(await store.claimDelivery(input)).toBe("process");
    const row = await client.query<{ status: string }>(
      `SELECT status FROM webhook_deliveries WHERE delivery_id = 'abandoned'`,
    );
    expect(row.rows[0]?.status).toBe("processing");
  });
});
