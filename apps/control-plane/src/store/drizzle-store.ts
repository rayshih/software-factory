import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, max, or, sql } from "drizzle-orm";
import { formatUsd } from "../money.js";
import { idempotencyKey } from "../tasks/ids.js";
import { ACTIVE_STATUSES, type TaskStatus } from "../tasks/status.js";
import type { AppDatabase } from "../db/client.js";
import { taskEvents, tasks, webhookDeliveries } from "../db/schema.js";
import {
  StaleRunError,
  TaskStatusConflict,
  type AppendEventInput,
  type ClaimRunInput,
  type CreateTaskInput,
  type DeliveryRecord,
  type DeliveryStatus,
  type TaskEventRecord,
  type TaskRecord,
  type TaskStore,
  type UpdateTaskPatch,
} from "./types.js";

/**
 * A processing claim older than this is treated as abandoned (the worker crashed
 * or never finished). Webhook handling should finish in seconds, so a later
 * redelivery can take the row. A fresher claim belongs to someone else.
 */
export const DELIVERY_CLAIM_STALE_AFTER = "2 minutes";

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
          runId: null,
          leaseExpiresAt: null,
        })
        .returning();
      if (!row) throw new Error("task insert returned no row");
      return mapTask(row);
    },

    async getTask(id) {
      const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      return row ? mapTask(row) : null;
    },

    async updateTask(id, patch, expectedStatus?: TaskStatus, expectedRunId?: string) {
      if (patch.status !== undefined && expectedStatus === undefined) {
        throw new Error(`task ${id} status change requires the status the caller observed`);
      }
      const conditions = [eq(tasks.id, id)];
      if (expectedStatus !== undefined) conditions.push(eq(tasks.status, expectedStatus));
      if (expectedRunId !== undefined) conditions.push(eq(tasks.runId, expectedRunId));
      const [row] = await db
        .update(tasks)
        .set(toUpdate(patch))
        .where(and(...conditions))
        .returning();
      if (!row) {
        if (expectedRunId !== undefined) throw new StaleRunError(id, expectedRunId);
        if (expectedStatus !== undefined) throw new TaskStatusConflict(id, expectedStatus);
        throw new Error(`task ${id} not found`);
      }
      return mapTask(row);
    },

    async claimRun(id, input: ClaimRunInput) {
      const [row] = await db
        .update(tasks)
        .set({
          status: "running",
          runId: input.runId,
          leaseExpiresAt: input.leaseExpiresAt,
          attempts: sql`${tasks.attempts} + 1`,
          startedAt: sql`COALESCE(${tasks.startedAt}, ${input.now})`,
          ciResult: null,
          reviewOutcome: null,
          failureReason: null,
          failureCategory: null,
          finishedAt: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(tasks.id, id),
            eq(tasks.status, input.expectedStatus),
            or(
              isNull(tasks.runId),
              isNull(tasks.leaseExpiresAt),
              lte(tasks.leaseExpiresAt, input.now),
            ),
          ),
        )
        .returning();
      return row ? mapTask(row) : null;
    },

    async renewRun(id, runId, leaseExpiresAt, now) {
      const rows = await db
        .update(tasks)
        .set({ leaseExpiresAt, updatedAt: now })
        .where(and(eq(tasks.id, id), eq(tasks.runId, runId)))
        .returning({ id: tasks.id });
      return rows.length > 0;
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
      const now = new Date();
      const claimed = await db
        .insert(webhookDeliveries)
        .values({
          deliveryId: input.deliveryId,
          eventName: input.eventName,
          action: input.action,
          repo: input.repo,
          status: "processing",
          disposition: "processing",
          receivedAt: now,
          claimedAt: now,
          claimGeneration: 1,
        })
        .onConflictDoUpdate({
          target: webhookDeliveries.deliveryId,
          set: {
            eventName: input.eventName,
            action: input.action,
            repo: input.repo,
            status: "processing",
            disposition: "processing",
            claimedAt: sql`now()`,
            claimGeneration: sql`${webhookDeliveries.claimGeneration} + 1`,
          },
          setWhere: or(
            eq(webhookDeliveries.status, "failed"),
            and(
              eq(webhookDeliveries.status, "processing"),
              sql`${webhookDeliveries.claimedAt} < ${sql.raw(`now() - interval '${DELIVERY_CLAIM_STALE_AFTER}'`)}`,
            ),
          ),
        })
        .returning({
          deliveryId: webhookDeliveries.deliveryId,
          claimGeneration: webhookDeliveries.claimGeneration,
        });
      const owned = claimed[0];
      if (owned) return { outcome: "process" as const, generation: Number(owned.claimGeneration) };

      const existing = await findDelivery(db, input.deliveryId);
      if (!existing) throw new Error(`delivery ${input.deliveryId} disappeared during claim`);
      if (existing.status === "processed") return { outcome: "duplicate" as const };
      return { outcome: "in_progress" as const };
    },

    async finishDelivery(deliveryId, status, disposition, generation) {
      const updated = await db
        .update(webhookDeliveries)
        .set({ status, disposition })
        .where(
          and(
            eq(webhookDeliveries.deliveryId, deliveryId),
            eq(webhookDeliveries.claimGeneration, generation),
          ),
        )
        .returning({ deliveryId: webhookDeliveries.deliveryId });
      return updated.length > 0;
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
  const { costUsdDelta, tokensDelta, interventionsDelta, humanInterventionMinutesDelta, ...rest } =
    patch;
  const set: Record<string, unknown> = {
    ...rest,
    updatedAt: rest.updatedAt ?? new Date(),
  };
  if (costUsdDelta !== undefined) {
    set.costUsd = sql`${tasks.costUsd} + ${costUsdDelta}::numeric`;
  }
  if (tokensDelta !== undefined) set.tokens = sql`${tasks.tokens} + ${tokensDelta}`;
  if (interventionsDelta !== undefined) {
    set.interventions = sql`${tasks.interventions} + ${interventionsDelta}`;
  }
  if (humanInterventionMinutesDelta !== undefined) {
    set.humanInterventionMinutes = sql`${tasks.humanInterventionMinutes} + ${humanInterventionMinutesDelta}`;
  }
  return set as Partial<typeof tasks.$inferInsert>;
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
    runId: row.runId,
    leaseExpiresAt: row.leaseExpiresAt ? asDate(row.leaseExpiresAt) : null,
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
    claimedAt: asDate(row.claimedAt),
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export type { CreateTaskInput, AppendEventInput, TaskStatus };
