import type { ForgeTask } from "@/lib/agents-types";

type CancelTaskInput = {
  task: ForgeTask;
  namespaceQuery: string;
  confirm: (message: string) => boolean;
  fetcher: typeof fetch;
  now?: () => Date;
  onOptimistic: (next: ForgeTask) => void;
  onRollback: (previous: ForgeTask) => void;
  onSuccess: (next: ForgeTask) => void;
  onError: (message: string) => void;
};

export function isForgeTaskCancellable(
  task: Pick<ForgeTask, "status">,
): boolean {
  return task.status === "running";
}

export function cancelledForgeTask(
  task: ForgeTask,
  now: () => Date = () => new Date(),
): ForgeTask {
  return {
    ...task,
    status: "cancelled",
    lane: "done",
    updated_at: now().toISOString(),
  };
}

export function cancelConfirmMessage(task: Pick<ForgeTask, "title">): string {
  return `Cancel task "${task.title}"?`;
}

export async function cancelForgeTaskOptimistically({
  task,
  namespaceQuery,
  confirm,
  fetcher,
  now = () => new Date(),
  onOptimistic,
  onRollback,
  onSuccess,
  onError,
}: CancelTaskInput): Promise<boolean> {
  if (!isForgeTaskCancellable(task)) return false;
  if (!confirm(cancelConfirmMessage(task))) return false;

  const optimistic = cancelledForgeTask(task, now);
  onOptimistic(optimistic);

  try {
    const res = await fetcher(
      `/api/forge/tasks/${task.id}/cancel${namespaceQuery}`,
      {
        method: "POST",
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      throw new Error(data.detail ?? data.error ?? `status ${res.status}`);
    }
    onSuccess((await readTaskResponse(res, optimistic)) ?? optimistic);
    return true;
  } catch (err) {
    onRollback(task);
    onError(err instanceof Error ? err.message : "cancel failed");
    return false;
  }
}

async function readTaskResponse(
  res: Response,
  fallback: ForgeTask,
): Promise<ForgeTask | null> {
  if (res.status === 204) return fallback;
  const data = await res.json().catch(() => null);
  if (isForgeTask(data)) return data;
  if (
    data &&
    typeof data === "object" &&
    "task" in data &&
    isForgeTask(data.task)
  ) {
    return data.task;
  }
  return fallback;
}

function isForgeTask(value: unknown): value is ForgeTask {
  if (!value || typeof value !== "object") return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "lane" in value &&
    typeof value.lane === "string" &&
    "status" in value &&
    typeof value.status === "string"
  );
}
