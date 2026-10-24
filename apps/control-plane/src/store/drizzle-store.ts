import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import { formatUsd } from "../money.js";
import { idempotencyKey } from "../tasks/ids.js";
import { ACTIVE_STATUSES, type TaskStatus } from "../tasks/status.js";
import { isUniqueViolation } from "../github/errors.js";
import type { AppDatabase } from "../db/client.js";
import { taskEvents, tasks, webhookDeliveries } from "../db/schema.js";
import type {
  AppendEventInput,
  CreateTaskInput,
  DeliveryRecord,
  DeliveryStatus,
  TaskEventRecord,
  TaskRecord,
  TaskStore,
  UpdateTaskPatch,
} from "./types.js";

type TaskRow = typeof tasks.$inferSelect;
type EventRow = typeof taskEvents.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

export function createTaskStore(db: AppDatabase): TaskStore {
  return {
    async nextAttemptGroup(repo, issueNumber) {
      const [row] = await db
        .select({ value: max(tasks.attemptGroup) })
        .from(tasks)
        .where(and(eq(tasks.repo, repo), eq(tasks.issueNumber, issueNumber)));
      return (row?.value ?? 0) + 1;
    },

    async createTask(input) {
      const now = input.createdAt;
      const [row] = await db
        .insert(tasks)
        .values({
          id: input.id,
          repo: input.repo,
          issueNumber: input.issueNumber,
          status: "queued",
          idempotencyKey: idempotencyKey(input.repo, input.issueNumber, input.attemptGroup),
          attemptGroup: input.attemptGroup,
          branch: input.branch,
          prNumber: null,
          prUrl: null,
          attempts: 0,
          costUsd: "0.000000",
          tokens: 0,
          interventions: 0,
          humanInterventionMinutes: 0,
          ciResult: null,
          reviewOutcome: null,
          failureReason: null,
          failureCategory: null,
          installationId: input.installationId,
          issueTitle: input.issueTitle,
          issueBody: input.issueBody,
          createdAt: now,
          updatedAt: now,
          startedAt: null,
          finishedAt: null,
        })
        .returning();
      if (!row) throw new Error("task insert returned no row");
      return mapTask(row);
    },

    async getTask(id) {
      const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      return row ? mapTask(row) : null;
    },

    async updateTask(id, patch) {
      const [row] = await db.update(tasks).set(toUpdate(patch)).where(eq(tasks.id, id)).returning();
      if (!row) throw new Error(`task ${id} not found`);
      return mapTask(row);
    },

    async findActiveTask(repo, issueNumber) {
      const [row] = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.repo, repo),
            eq(tasks.issueNumber, issueNumber),
            inArray(tasks.status, [...ACTIVE_STATUSES]),
          ),
        )
        .limit(1);
      return row ? mapTask(row) : null;
    },

    async findByBranch(repo, branch) {
      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.repo, repo), eq(tasks.branch, branch)))
        .orderBy(desc(tasks.createdAt));
      return preferActive(rows);
    },

    async findByPullRequest(repo, prNumber) {
      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.repo, repo), eq(tasks.prNumber, prNumber)))
        .orderBy(desc(tasks.createdAt));
      return preferActive(rows);
    },

    async listTasks() {
      const rows = await db.select().from(tasks).orderBy(tasks.createdAt);
      return rows.map(mapTask);
    },

    async appendEvent(input) {
      const [row] = await db
        .insert(taskEvents)
        .values({
          id: randomUUID(),
          taskId: input.taskId,
          type: input.type,
          message: input.message,
          payload: input.payload ?? {},
          createdAt: input.createdAt ?? new Date(),
        })
        .returning();
      if (!row) throw new Error("task event insert returned no row");
      return mapEvent(row);
    },

    async listEvents(taskId) {
      const rows = await db
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, taskId))
        .orderBy(taskEvents.createdAt);
      return rows.map(mapEvent);
    },

    async claimDelivery(input) {
      const existing = await findDelivery(db, input.deliveryId);
      if (existing?.status === "processed") return "duplicate";
      if (!existing) {
        try {
          await db.insert(webhookDeliveries).values({
            deliveryId: input.deliveryId,
            eventName: input.eventName,
            action: input.action,
            repo: input.repo,
            status: "processing",
            disposition: "processing",
            receivedAt: new Date(),
          });
          return "process";
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const raced = await findDelivery(db, input.deliveryId);
          if (raced?.status === "processed") return "duplicate";
          return "process";
        }
      }
      await db
        .update(webhookDeliveries)
        .set({
          status: "processing",
          eventName: input.eventName,
          action: input.action,
          repo: input.repo,
        })
        .where(eq(webhookDeliveries.deliveryId, input.deliveryId));
      return "process";
    },

    async finishDelivery(deliveryId, status, disposition) {
      await db
        .update(webhookDeliveries)
        .set({ status, disposition })
        .where(eq(webhookDeliveries.deliveryId, deliveryId));
    },

    async getDelivery(deliveryId) {
      return findDelivery(db, deliveryId);
    },
  };
}

async function findDelivery(db: AppDatabase, deliveryId: string): Promise<DeliveryRecord | null> {
  const [row] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.deliveryId, deliveryId))
    .limit(1);
  return row ? mapDelivery(row) : null;
}

function preferActive(rows: TaskRow[]): TaskRecord | null {
  const active = rows.find((row) => (ACTIVE_STATUSES as readonly string[]).includes(row.status));
  const chosen = active ?? rows[0];
  return chosen ? mapTask(chosen) : null;
}

function toUpdate(patch: UpdateTaskPatch): Partial<typeof tasks.$inferInsert> {
  return {
    ...patch,
    updatedAt: patch.updatedAt ?? new Date(),
  };
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    repo: row.repo,
    issueNumber: row.issueNumber,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    attemptGroup: row.attemptGroup,
    branch: row.branch,
    prNumber: row.prNumber,
    prUrl: row.prUrl,
    attempts: row.attempts,
    costUsd: formatUsd(String(row.costUsd)),
    tokens: row.tokens,
    interventions: row.interventions,
    humanInterventionMinutes: row.humanInterventionMinutes,
    ciResult: row.ciResult,
    reviewOutcome: row.reviewOutcome,
    failureReason: row.failureReason,
    failureCategory: row.failureCategory,
    installationId: row.installationId,
    issueTitle: row.issueTitle,
    issueBody: row.issueBody,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
    startedAt: row.startedAt ? asDate(row.startedAt) : null,
    finishedAt: row.finishedAt ? asDate(row.finishedAt) : null,
  };
}

function mapEvent(row: EventRow): TaskEventRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    type: row.type,
    message: row.message,
    payload: row.payload ?? {},
    createdAt: asDate(row.createdAt),
  };
}

function mapDelivery(row: DeliveryRow): DeliveryRecord {
  return {
    deliveryId: row.deliveryId,
    eventName: row.eventName,
    action: row.action,
    repo: row.repo,
    status: row.status as DeliveryStatus,
    disposition: row.disposition,
    receivedAt: asDate(row.receivedAt),
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export type { CreateTaskInput, AppendEventInput, TaskStatus };
