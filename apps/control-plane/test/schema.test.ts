import { PGlite } from "@electric-sql/pglite";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../src/db/migrate.js";
import { taskEvents, tasks, webhookDeliveries } from "../src/db/schema.js";

interface LiveColumn {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  numeric_precision: number | string | null;
  numeric_scale: number | string | null;
}

interface LiveConstraint {
  conname: string;
  contype: string;
  definition: string;
}

function liveType(column: LiveColumn): string {
  if (column.data_type === "USER-DEFINED") return column.udt_name;
  if (column.data_type === "numeric") {
    return `numeric(${Number(column.numeric_precision)}, ${Number(column.numeric_scale)})`;
  }
  return column.data_type;
}

describe("schema drift", () => {
  it("matches columns, types, nullability, checks, foreign keys, and indexes after migrations", async () => {
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

    for (const table of [tasks, webhookDeliveries, taskEvents]) {
      const config = getTableConfig(table);
      const columns = await client.query<LiveColumn>(
        `SELECT column_name, data_type, udt_name, is_nullable, numeric_precision, numeric_scale
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = '${config.name}'
         ORDER BY ordinal_position`,
      );
      const liveByName = new Map(columns.rows.map((row) => [row.column_name, row]));
      expect([...liveByName.keys()].sort()).toEqual(
        config.columns.map((column) => column.name).sort(),
      );

      for (const column of config.columns) {
        const live = liveByName.get(column.name);
        expect(live, column.name).toBeDefined();
        expect(liveType(live as LiveColumn), column.name).toBe((column as PgColumn).getSQLType());
        expect((column as PgColumn).notNull, column.name).toBe(live?.is_nullable === "NO");
      }

      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${config.name}'`,
      );
      const indexNames = indexes.rows
        .map((row) => row.indexname)
        .filter((name) => !name.endsWith("_pkey"));
      const declaredIndexes = [
        ...config.indexes.map((index) => index.config.name),
        ...config.uniqueConstraints.map((constraint) => constraint.name),
      ];
      expect(indexNames.sort()).toEqual(declaredIndexes.sort());

      const constraints = await client.query<LiveConstraint>(
        `SELECT conname, contype, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conrelid = 'public.${config.name}'::regclass`,
      );
      const names = (kind: string) =>
        constraints.rows.filter((row) => row.contype === kind).map((row) => row.conname);
      expect(names("c").sort()).toEqual(config.checks.map((check) => check.name).sort());
      expect(names("u").sort()).toEqual(
        config.uniqueConstraints.map((constraint) => constraint.name).sort(),
      );
      expect(names("f").sort()).toEqual(config.foreignKeys.map((key) => key.getName()).sort());
    }

    const foreignKey = await client.query<LiveConstraint>(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname = 'task_events_task_id_fkey'`,
    );
    expect(foreignKey.rows[0]?.definition).toBe("FOREIGN KEY (task_id) REFERENCES tasks(id)");
  });
});
