import type {
  WorkbenchInvocationLogRow,
  WorkbenchPreflightResult,
  WorkbenchStartResponse,
} from "./types";
import { getWorkbenchSupabase } from "./supabase";

const TABLE = "workbench_run_history";
const RUN_COLUMNS =
  "id,user_id,ask,result,retrieval,invocation,created_at" as const;
const DEFAULT_RUN_LIMIT = 20;
const MAX_RUN_LIMIT = 50;

type SupabaseErrorLike = { message?: string } | null;
type SupabaseResult<T> = PromiseLike<{
  data: T | null;
  error: SupabaseErrorLike;
}>;
type SupabaseListResult<T> = PromiseLike<{
  data: T[] | null;
  error: SupabaseErrorLike;
}>;

type SupabaseLike = {
  from(table: string): {
    insert(payload: WorkbenchRunHistoryInsertPayload): {
      select(columns: string): {
        single(): SupabaseResult<WorkbenchRunHistoryRow>;
      };
    };
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          maybeSingle(): SupabaseResult<WorkbenchRunHistoryRow>;
        };
        order(
          column: string,
          options: { ascending: boolean },
        ): {
          limit(count: number): SupabaseListResult<WorkbenchRunHistoryRow>;
        };
      };
    };
  };
};

export type WorkbenchRunHistoryRow = {
  id: string;
  user_id: string;
  ask: string;
  result: WorkbenchPreflightResult;
  retrieval: WorkbenchStartResponse["retrieval"];
  invocation: WorkbenchInvocationLogRow;
  created_at: string;
};

export type WorkbenchRunHistoryInsertInput = {
  userId: string;
  ask: string;
  result: WorkbenchPreflightResult;
  retrieval: WorkbenchStartResponse["retrieval"];
  invocation: WorkbenchInvocationLogRow;
};

type WorkbenchRunHistoryInsertPayload = {
  user_id: string;
  ask: string;
  result: WorkbenchPreflightResult;
  retrieval: WorkbenchStartResponse["retrieval"];
  invocation: WorkbenchInvocationLogRow;
};

export type WorkbenchRunHistoryPersistResult =
  | { status: "stored"; run: WorkbenchRunHistoryRow }
  | { status: "unavailable"; error: "workbench_run_history_unavailable" }
  | { status: "error"; error: "workbench_run_history_failed"; detail: string };

export type WorkbenchRunHistoryListResult =
  | { status: "ok"; runs: WorkbenchRunHistoryRow[] }
  | {
      status: "unavailable";
      runs: [];
      error: "workbench_run_history_unavailable";
    }
  | {
      status: "error";
      runs: [];
      error: "workbench_run_history_failed";
      detail: string;
    };

export type WorkbenchRunHistoryGetResult =
  | { status: "ok"; run: WorkbenchRunHistoryRow | null }
  | { status: "unavailable"; error: "workbench_run_history_unavailable" }
  | { status: "error"; error: "workbench_run_history_failed"; detail: string };

export async function persistWorkbenchRun(
  input: WorkbenchRunHistoryInsertInput,
): Promise<WorkbenchRunHistoryPersistResult> {
  const sb = getWorkbenchRunHistorySupabase();
  if (!sb) {
    return {
      status: "unavailable",
      error: "workbench_run_history_unavailable",
    };
  }

  try {
    const { data, error } = await sb
      .from(TABLE)
      .insert({
        user_id: input.userId,
        ask: input.ask,
        result: input.result,
        retrieval: input.retrieval,
        invocation: input.invocation,
      })
      .select(RUN_COLUMNS)
      .single();

    if (error || !data) return failed(error, "Unknown Workbench run save error.");
    return { status: "stored", run: data };
  } catch (err) {
    return failed(err, "Unknown Workbench run save error.");
  }
}

export async function listWorkbenchRuns(input: {
  userId: string;
  limit?: number;
}): Promise<WorkbenchRunHistoryListResult> {
  const sb = getWorkbenchRunHistorySupabase();
  if (!sb) {
    return {
      status: "unavailable",
      runs: [],
      error: "workbench_run_history_unavailable",
    };
  }

  try {
    const { data, error } = await sb
      .from(TABLE)
      .select(RUN_COLUMNS)
      .eq("user_id", input.userId)
      .order("created_at", { ascending: false })
      .limit(normalizeLimit(input.limit));

    if (error) return { ...failed(error), runs: [] };
    return { status: "ok", runs: data ?? [] };
  } catch (err) {
    return { ...failed(err), runs: [] };
  }
}

export async function getWorkbenchRun(input: {
  userId: string;
  id: string;
}): Promise<WorkbenchRunHistoryGetResult> {
  const sb = getWorkbenchRunHistorySupabase();
  if (!sb) {
    return {
      status: "unavailable",
      error: "workbench_run_history_unavailable",
    };
  }

  try {
    const { data, error } = await sb
      .from(TABLE)
      .select(RUN_COLUMNS)
      .eq("id", input.id)
      .eq("user_id", input.userId)
      .maybeSingle();

    if (error) return failed(error);
    return { status: "ok", run: data ?? null };
  } catch (err) {
    return failed(err);
  }
}

export function normalizeWorkbenchRunLimit(limit: number | undefined): number {
  return normalizeLimit(limit);
}

function getWorkbenchRunHistorySupabase(): SupabaseLike | null {
  return getWorkbenchSupabase() as unknown as SupabaseLike | null;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_RUN_LIMIT;
  const rounded = Math.trunc(limit ?? DEFAULT_RUN_LIMIT);
  if (rounded < 1) return DEFAULT_RUN_LIMIT;
  return Math.min(rounded, MAX_RUN_LIMIT);
}

function failed(
  error: unknown,
  fallback = "Unknown Workbench run history error.",
): Extract<WorkbenchRunHistoryPersistResult, { status: "error" }> {
  return {
    status: "error",
    error: "workbench_run_history_failed",
    detail: errorMessage(error, fallback),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  if (typeof error === "string") return error;
  return fallback;
}
