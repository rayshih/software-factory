import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { applyMigrations, type SqlExecutor } from "./migrate.js";
import { createTaskStore } from "../store/drizzle-store.js";
import type { TaskStore } from "../store/types.js";

export type AppDatabase = PostgresJsDatabase<typeof schema>;

export function createPostgresClient(databaseUrl: string): postgres.Sql {
  return postgres(databaseUrl, { max: 10, onnotice: () => {} });
}

export function postgresExecutor(sql: postgres.Sql): SqlExecutor {
  return {
    async exec(text) {
      await sql.unsafe(text);
    },
    async query<T extends Record<string, unknown>>(text: string) {
      return (await sql.unsafe(text)) as unknown as T[];
    },
  };
}

export async function openDatabase(databaseUrl: string): Promise<{
  store: TaskStore;
  db: AppDatabase;
  close: () => Promise<void>;
}> {
  const sql = createPostgresClient(databaseUrl);
  await applyMigrations(postgresExecutor(sql));
  const db = drizzle(sql, { schema });
  return {
    store: createTaskStore(db),
    db,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
