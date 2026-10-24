import type { TaskStatus } from "../tasks/status.js";

export interface TaskRecord {
  id: string;
  repo: string;
  issueNumber: number;
  status: TaskStatus;
  idempotencyKey: string;
  attemptGroup: number;
  branch: string;
  prNumber: number | null;
  prUrl: string | null;
  attempts: number;
  costUsd: string;
  tokens: number;
  interventions: number;
  humanInterventionMinutes: number;
  ciResult: string | null;
  reviewOutcome: string | null;
  failureReason: string | null;
  failureCategory: string | null;
  installationId: number;
  issueTitle: string;
  issueBody: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface CreateTaskInput {
  id: string;
  repo: string;
  issueNumber: number;
  attemptGroup: number;
  branch: string;
  installationId: number;
  issueTitle: string;
  issueBody: string;
  createdAt: Date;
}

/** The update ran, but the task was no longer in the status the caller had observed. */
export class TaskStatusConflict extends Error {
  readonly taskId: string;
  readonly expectedStatus: TaskStatus;

  constructor(taskId: string, expectedStatus: TaskStatus) {
    super(`task ${taskId} is no longer ${expectedStatus}`);
    this.name = "TaskStatusConflict";
    this.taskId = taskId;
    this.expectedStatus = expectedStatus;
  }
}

export interface UpdateTaskPatch {
  status?: TaskStatus;
  prNumber?: number | null;
  prUrl?: string | null;
  attempts?: number;
  costUsd?: string;
  tokens?: number;
  interventions?: number;
  humanInterventionMinutes?: number;
  ciResult?: string | null;
  reviewOutcome?: string | null;
  failureReason?: string | null;
  failureCategory?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  updatedAt?: Date;
}

export interface TaskEventRecord {
  id: string;
  taskId: string;
  type: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface AppendEventInput {
  taskId: string;
  type: string;
  message: string;
  payload?: Record<string, unknown>;
  createdAt?: Date;
}

export type DeliveryStatus = "processing" | "processed" | "failed";

export interface DeliveryRecord {
  deliveryId: string;
  eventName: string;
  action: string | null;
  repo: string | null;
  status: DeliveryStatus;
  disposition: string;
  receivedAt: Date;
  /** When the current processing claim started. Moved forward on each reclaim. */
  claimedAt: Date;
}

export interface ClaimDeliveryInput {
  deliveryId: string;
  eventName: string;
  action: string | null;
  repo: string | null;
}

export type ClaimDeliveryResult =
  | { outcome: "process"; generation: number }
  | { outcome: "duplicate" }
  | { outcome: "in_progress" };

/**
 * Append-only task events. There is intentionally no update or delete.
 * Webhook deliveries are updated only to move processing → processed/failed,
 * and only by the claim generation that still owns the row.
 */
export interface TaskStore {
  nextAttemptGroup(repo: string, issueNumber: number): Promise<number>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  getTask(id: string): Promise<TaskRecord | null>;
  /**
   * When `patch.status` is set, `expectedStatus` is the status the caller
   * observed. The write matches that status, so a concurrent transition is
   * not overwritten. Allowed edges are checked by `transitionTask`.
   */
  updateTask(id: string, patch: UpdateTaskPatch, expectedStatus?: TaskStatus): Promise<TaskRecord>;
  findActiveTask(repo: string, issueNumber: number): Promise<TaskRecord | null>;
  findByBranch(repo: string, branch: string): Promise<TaskRecord | null>;
  findByPullRequest(repo: string, prNumber: number): Promise<TaskRecord | null>;
  listTasks(): Promise<TaskRecord[]>;
  appendEvent(input: AppendEventInput): Promise<TaskEventRecord>;
  listEvents(taskId: string): Promise<TaskEventRecord[]>;
  /**
   * `process` means this caller owns the delivery, and `generation` is the
   * fence `finishDelivery` must present. `duplicate` means it was already
   * processed. `in_progress` means another caller owns a claim that is still fresh.
   */
  claimDelivery(input: ClaimDeliveryInput): Promise<ClaimDeliveryResult>;
  /**
   * Writes the outcome only while `generation` still owns the row.
   * Returns false when a newer claim has taken the delivery.
   */
  finishDelivery(
    deliveryId: string,
    status: DeliveryStatus,
    disposition: string,
    generation: number,
  ): Promise<boolean>;
  getDelivery(deliveryId: string): Promise<DeliveryRecord | null>;
}
