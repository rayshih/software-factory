import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  query<T extends Record<string, unknown>>(sql: string): Promise<T[]>;
}

export async function applyMigrations(executor: SqlExecutor): Promise<string[]> {
  await executor.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const applied: string[] = [];
  for (const file of migrationFiles()) {
    const rows = await executor.query<{ id: string }>(
      `SELECT id FROM schema_migrations WHERE id = '${file.replaceAll("'", "''")}'`,
    );
    if (rows.length > 0) continue;
    const sql = readFileSync(join(migrationsDirectory(), file), "utf8");
    await executor.exec(sql);
    await executor.exec(
      `INSERT INTO schema_migrations (id) VALUES ('${file.replaceAll("'", "''")}')`,
    );
    applied.push(file);
  }
  return applied;
}

function migrationFiles(): string[] {
  return readdirSync(migrationsDirectory())
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
