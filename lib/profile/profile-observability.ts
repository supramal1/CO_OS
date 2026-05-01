const DEFAULT_SLOW_MS = 750;

export type ProfileTimingLog = {
  area: string;
  label: string;
  durationMs: number;
  ok: boolean;
  userId?: string;
  detail?: string;
};

export async function withProfileTiming<T>(
  input: {
    area: string;
    label: string;
    userId?: string;
    slowMs?: number;
    detail?: string;
  },
  operation: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await operation();
    logProfileTiming({
      area: input.area,
      label: input.label,
      userId: input.userId,
      detail: input.detail,
      durationMs: Date.now() - start,
      ok: true,
    }, input.slowMs);
    return result;
  } catch (error) {
    logProfileTiming({
      area: input.area,
      label: input.label,
      userId: input.userId,
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      ok: false,
    }, input.slowMs);
    throw error;
  }
}

export function logProfileTiming(
  log: ProfileTimingLog,
  slowMs: number = DEFAULT_SLOW_MS,
): void {
  const payload = {
    area: log.area,
    label: log.label,
    durationMs: log.durationMs,
    ok: log.ok,
    userId: log.userId,
    detail: log.detail,
  };

  if (!log.ok) {
    console.warn("[profile] operation failed", payload);
    return;
  }

  if (log.durationMs >= slowMs) {
    console.warn("[profile] slow operation", payload);
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[profile] operation complete", payload);
  }
}
