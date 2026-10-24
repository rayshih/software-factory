import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { applyMigrations } from "../src/db/migrate.js";
import * as schema from "../src/db/schema.js";
import type { AppDatabase } from "../src/db/client.js";
import { createTaskStore } from "../src/store/drizzle-store.js";
import type { TaskStore } from "../src/store/types.js";
import type { Clock } from "../src/clock.js";

export const WEBHOOK_SECRET = "test-webhook-secret";
export const DEMO_REPO = "rayshih/sf-demo-todo-api";

export const fixedClock: Clock = {
  now: () => new Date("2026-10-26T00:00:00.000Z"),
};

export async function createTestStore(): Promise<TaskStore> {
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
  return createTaskStore(db as unknown as AppDatabase);
}
