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
}

export interface ClaimDeliveryInput {
  deliveryId: string;
  eventName: string;
  action: string | null;
  repo: string | null;
}

/**
 * Append-only task events. There is intentionally no update or delete.
 * Webhook deliveries are updated only to move processing → processed/failed.
 */
export interface TaskStore {
  nextAttemptGroup(repo: string, issueNumber: number): Promise<number>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  getTask(id: string): Promise<TaskRecord | null>;
  updateTask(id: string, patch: UpdateTaskPatch): Promise<TaskRecord>;
  findActiveTask(repo: string, issueNumber: number): Promise<TaskRecord | null>;
  findByBranch(repo: string, branch: string): Promise<TaskRecord | null>;
  findByPullRequest(repo: string, prNumber: number): Promise<TaskRecord | null>;
  listTasks(): Promise<TaskRecord[]>;
  appendEvent(input: AppendEventInput): Promise<TaskEventRecord>;
  listEvents(taskId: string): Promise<TaskEventRecord[]>;
  claimDelivery(input: ClaimDeliveryInput): Promise<"process" | "duplicate">;
  finishDelivery(deliveryId: string, status: DeliveryStatus, disposition: string): Promise<void>;
  getDelivery(deliveryId: string): Promise<DeliveryRecord | null>;
}
