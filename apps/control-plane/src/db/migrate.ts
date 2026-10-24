import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Session-scoped Postgres advisory lock. Every web process and Trigger.dev worker
 * takes this before migrating so two cold starts cannot apply the same file.
 * One session can take it more than once; it only excludes other sessions.
 */
const MIGRATION_LOCK_KEY = 724031014;

/**
 * One database session. `BEGIN` / `COMMIT` and the advisory lock are session
 * state, so every call must use the same connection.
 */
export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  query<T extends Record<string, unknown>>(sql: string): Promise<T[]>;
}

export async function applyMigrations(
  executor: SqlExecutor,
  directory: string = migrationsDirectory(),
): Promise<string[]> {
  await executor.exec(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
  try {
    await executor.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied: string[] = [];
    for (const file of migrationFiles(directory)) {
      await applyOne(executor, directory, file, applied);
    }
    return applied;
  } finally {
    try {
      await executor.exec(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
    } catch {
      // The session is already gone. Postgres releases the lock when it closes.
    }
  }
}

async function applyOne(
  executor: SqlExecutor,
  directory: string,
  file: string,
  applied: string[],
): Promise<void> {
  const id = file.replaceAll("'", "''");
  await executor.exec("BEGIN");
  try {
    const rows = await executor.query<{ id: string }>(
      `SELECT id FROM schema_migrations WHERE id = '${id}'`,
    );
    if (rows.length === 0) {
      await executor.exec(readFileSync(join(directory, file), "utf8"));
      await executor.exec(`INSERT INTO schema_migrations (id) VALUES ('${id}')`);
      applied.push(file);
    }
    await executor.exec("COMMIT");
  } catch (error) {
    try {
      await executor.exec("ROLLBACK");
    } catch {
      // No open transaction. The original error is the one that matters.
    }
    throw error;
  }
}

function migrationFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((file) => /^[0-9][A-Za-z0-9_.-]*\.sql$/.test(file))
    .sort();
}

export function migrationsDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../../migrations"), join(here, "../../../migrations")];
  for (const candidate of candidates) {
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      // try the next location (src/ during tests, dist/ after build)
    }
  }
  throw new Error(`migrations directory not found from ${here}`);
}
