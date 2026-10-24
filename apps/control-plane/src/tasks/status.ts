export const TASK_STATUSES = [
  "queued",
  "running",
  "pr_opened",
  "ci_passed",
  "ci_failed",
  "needs_human",
  "accepted",
  "rejected",
  "failed",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ACTIVE_STATUSES: readonly TaskStatus[] = [
  "queued",
  "running",
  "pr_opened",
  "ci_passed",
  "ci_failed",
  "needs_human",
];

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["accepted", "rejected", "failed"];

const ALLOWED: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["running", "failed"],
  running: ["pr_opened", "failed", "needs_human"],
  pr_opened: ["ci_passed", "ci_failed", "needs_human", "queued", "accepted", "rejected", "failed"],
  ci_passed: ["needs_human", "accepted", "rejected", "queued", "failed"],
  ci_failed: ["needs_human", "queued", "running", "accepted", "rejected", "failed"],
  needs_human: ["accepted", "rejected", "queued", "failed"],
  accepted: [],
  rejected: [],
  failed: [],
};

export function isTerminal(status: TaskStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isActive(status: TaskStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertCanTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid task status transition: ${from} -> ${to}`);
  }
}
