import {
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { TASK_STATUSES } from "../tasks/status.js";

/**
 * Column mapping for queries. The SQL in migrations/ is what actually creates
 * the database, including the partial unique index that enforces one active
 * task per issue.
 */
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);

export const tasks = pgTable("tasks", {
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
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  eventName: text("event_name").notNull(),
  action: text("action"),
  repo: text("repo"),
  status: text("status").notNull(),
  disposition: text("disposition").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
});

export const taskEvents = pgTable("task_events", {
  id: uuid("id").primaryKey(),
  taskId: uuid("task_id").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
