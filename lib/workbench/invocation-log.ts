import type {
  WorkbenchInvocationLogRow,
  WorkbenchInvocationType,
  WorkbenchTaskType,
} from "./types";

export type BuildWorkbenchInvocationLogInput<
  TInvocationType extends WorkbenchInvocationType = WorkbenchInvocationType,
> = {
  userId: string;
  invocationType: TInvocationType;
  taskType: WorkbenchTaskType | string;
  skillName: string;
  skillVersion?: string | null;
  estimatedBeforeMinutes: number;
  observedAfterMinutes?: number | null;
  latencyMs?: number | null;
  ask: string;
  status: "succeeded" | "failed";
  error?: string | null;
  createdAt?: Date;
};

export function buildWorkbenchInvocationLog<
  TInvocationType extends WorkbenchInvocationType,
>(
  input: BuildWorkbenchInvocationLogInput<TInvocationType>,
): WorkbenchInvocationLogRow & { invocation_type: TInvocationType } {
  return {
    user_id: input.userId,
    invocation_type: input.invocationType,
    task_type: input.taskType,
    skill_name: input.skillName,
    skill_version: input.skillVersion ?? null,
    estimated_before_minutes: Math.max(
      0,
      Math.round(input.estimatedBeforeMinutes),
    ),
    observed_after_minutes: input.observedAfterMinutes ?? null,
    latency_ms:
      input.latencyMs == null ? null : Math.max(0, Math.round(input.latencyMs)),
    ask_chars: input.ask.length,
    status: input.status,
    error: input.error ?? null,
    created_at: (input.createdAt ?? new Date()).toISOString(),
  };
}
