import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations, type SqlExecutor } from "../src/db/migrate.js";

function executor(client: PGlite): SqlExecutor {
  return {
    async exec(sql) {
      await client.exec(sql);
    },
    async query<T extends Record<string, unknown>>(sql: string) {
      const result = await client.query<T>(sql);
      return result.rows;
    },
  };
}

describe("applyMigrations", () => {
  it("applies the real migrations once and skips them on the next boot", async () => {
    const client = new PGlite();
    const database = executor(client);
    expect(await applyMigrations(database)).toEqual(["0001_init.sql"]);
    expect(await applyMigrations(database)).toEqual([]);
  });

  it("rolls back a failed file so it is not recorded, then applies it once it is valid", async () => {
    const directory = mkdtempSync(join(tmpdir(), "control-plane-migrations-"));
    writeFileSync(join(directory, "0001_ok.sql"), "CREATE TABLE scratch (id integer PRIMARY KEY);");
    writeFileSync(join(directory, "0002_bad.sql"), "SELECT * FROM definitely_missing;");
    const client = new PGlite();
    const database = executor(client);

    await expect(applyMigrations(database, directory)).rejects.toThrow();

    const recorded = await client.query<{ id: string }>(
      "SELECT id FROM schema_migrations ORDER BY id",
    );
    expect(recorded.rows.map((row) => row.id)).toEqual(["0001_ok.sql"]);
    const scratch = await client.query<{ name: string | null }>(
      "SELECT to_regclass('public.scratch')::text AS name",
    );
    expect(scratch.rows[0]?.name).toBe("scratch");

    writeFileSync(
      join(directory, "0002_bad.sql"),
      "CREATE TABLE scratch_ok (id integer PRIMARY KEY);",
    );
    expect(await applyMigrations(database, directory)).toEqual(["0002_bad.sql"]);
    const after = await client.query<{ id: string }>(
      "SELECT id FROM schema_migrations ORDER BY id",
    );
    expect(after.rows.map((row) => row.id)).toEqual(["0001_ok.sql", "0002_bad.sql"]);
  });
});
