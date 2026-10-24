import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { TASK_STATUSES } from "../tasks/status.js";

/**
 * Query mapping for the tables created by migrations/0001_init.sql.
 * The SQL file is what runs. This definition mirrors columns, nullability,
 * checks, the task_events foreign key, and indexes so tests can catch drift.
 */
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey(),
    repo: text("repo").notNull(),
    issueNumber: integer("issue_number").notNull(),
    status: taskStatusEnum("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attemptGroup: integer("attempt_group").notNull(),
    branch: text("branch").notNull(),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    attempts: integer("attempts").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    tokens: integer("tokens").notNull(),
    interventions: integer("interventions").notNull(),
    humanInterventionMinutes: integer("human_intervention_minutes").notNull(),
    ciResult: text("ci_result"),
    reviewOutcome: text("review_outcome"),
    failureReason: text("failure_reason"),
    failureCategory: text("failure_category"),
    installationId: integer("installation_id").notNull(),
    issueTitle: text("issue_title").notNull(),
    issueBody: text("issue_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    unique("tasks_idempotency_key_key").on(table.idempotencyKey),
    uniqueIndex("tasks_one_active_per_issue")
      .on(table.repo, table.issueNumber)
      .where(
        sql`${table.status} IN ('queued', 'running', 'pr_opened', 'ci_passed', 'ci_failed', 'needs_human')`,
      ),
    index("tasks_repo_issue_idx").on(table.repo, table.issueNumber),
    index("tasks_branch_idx").on(table.repo, table.branch),
    check("tasks_attempt_group_positive", sql`${table.attemptGroup} >= 1`),
    check("tasks_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check("tasks_cost_nonnegative", sql`${table.costUsd} >= 0`),
    check("tasks_tokens_nonnegative", sql`${table.tokens} >= 0`),
    check("tasks_interventions_nonnegative", sql`${table.interventions} >= 0`),
    check("tasks_minutes_nonnegative", sql`${table.humanInterventionMinutes} >= 0`),
    check(
      "tasks_idempotency_key_format",
      sql`${table.idempotencyKey} = ${table.repo} || '#' || ${table.issueNumber}::text || '#' || ${table.attemptGroup}::text`,
    ),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    eventName: text("event_name").notNull(),
    action: text("action"),
    repo: text("repo"),
    status: text("status").notNull(),
    disposition: text("disposition").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
    claimGeneration: integer("claim_generation").notNull(),
  },
  (table) => [
    check(
      "webhook_deliveries_status_check",
      sql`${table.status} IN ('processing', 'processed', 'failed')`,
    ),
  ],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id").notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("task_events_task_id_created_at_idx").on(table.taskId, table.createdAt),
    foreignKey({
      name: "task_events_task_id_fkey",
      columns: [table.taskId],
      foreignColumns: [tasks.id],
    }),
  ],
);
