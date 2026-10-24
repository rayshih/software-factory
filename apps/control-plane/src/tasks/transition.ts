import type { PipelineDependencies } from "../pipeline.js";
import type { TaskRecord, UpdateTaskPatch } from "../store/types.js";
import { assertCanTransition, isTerminal, type TaskStatus } from "./status.js";

export async function transitionTask(
  deps: PipelineDependencies,
  task: TaskRecord,
  to: TaskStatus,
  patch: UpdateTaskPatch,
  event: { type: string; message: string; payload?: Record<string, unknown> },
): Promise<TaskRecord> {
  assertCanTransition(task.status, to);
  const updated = await deps.store.updateTask(task.id, {
    ...patch,
    status: to,
    finishedAt: isTerminal(to)
      ? (patch.finishedAt ?? deps.clock.now())
      : (patch.finishedAt ?? null),
  });
  await deps.store.appendEvent({
    taskId: task.id,
    type: event.type,
    message: event.message,
    payload: { from: task.status, to, ...event.payload },
    createdAt: deps.clock.now(),
  });
  return updated;
}
