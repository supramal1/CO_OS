import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkbenchInvocationLogRow,
  WorkbenchPreflightResult,
  WorkbenchStartResponse,
} from "@/lib/workbench/types";

const mocks = vi.hoisted(() => ({
  getWorkbenchSupabase: vi.fn(),
}));

vi.mock("@/lib/workbench/supabase", () => ({
  getWorkbenchSupabase: () => mocks.getWorkbenchSupabase(),
}));

import {
  getWorkbenchRun,
  listWorkbenchRuns,
  persistWorkbenchRun,
} from "@/lib/workbench/run-history";

type SupabaseCall = {
  table: string;
  operation: string;
  payload?: unknown;
  match?: Record<string, string>;
  options?: unknown;
};

const result: WorkbenchPreflightResult = {
  decoded_task: {
    summary: "Reply to the client",
    requester: "Client",
    deliverable_type: "email",
    task_type: "ask_decode",
  },
  missing_context: [],
  drafted_clarifying_message: "Can you confirm the deadline?",
  retrieved_context: [],
  suggested_approach: [],
  time_estimate: {
    estimated_before_minutes: 30,
    estimated_workbench_minutes: 10,
    task_type: "ask_decode",
  },
  warnings: [],
};

const retrieval: WorkbenchStartResponse["retrieval"] = {
  context: [
    {
      claim: "Calendar event: Client review",
      source_type: "calendar",
      source_label: "Client review",
      source_url: "https://calendar.google.com/event?eid=event-1",
    },
  ],
  statuses: [
    {
      source: "calendar",
      status: "ok",
      items_count: 1,
    },
  ],
  sources: [
    {
      source: "calendar",
      status: "available",
      items: [
        {
          claim: "Calendar event: Client review",
          source_type: "calendar",
          source_label: "Client review",
          source_url: "https://calendar.google.com/event?eid=event-1",
        },
      ],
      warnings: [],
    },
  ],
  warnings: [],
  generated_at: "2026-04-29T12:00:00.000Z",
};

const invocation: WorkbenchInvocationLogRow = {
  user_id: "principal_123",
  invocation_type: "preflight",
  task_type: "ask_decode",
  skill_name: "workbench-preflight",
  skill_version: "0.1.0",
  estimated_before_minutes: 30,
  observed_after_minutes: null,
  latency_ms: 500,
  ask_chars: 28,
  status: "succeeded",
  error: null,
  created_at: "2026-04-29T12:00:01.000Z",
};

const storedRun = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "principal_123",
  ask: "Help me reply to the client",
  result,
  retrieval,
  invocation,
  created_at: "2026-04-29T12:00:02.000Z",
};

function createSupabaseDouble(options: {
  insertData?: Record<string, unknown> | null;
  listData?: Array<Record<string, unknown>>;
  getData?: Record<string, unknown> | null;
  error?: { message?: string } | null;
}) {
  const calls: SupabaseCall[] = [];

  return {
    calls,
    from(table: string) {
      return {
        insert(payload: unknown) {
          calls.push({ table, operation: "insert", payload });
          return {
            select(columns: string) {
              calls.push({ table, operation: "insert.select", payload: columns });
              return {
                async single() {
                  return {
                    data: options.insertData ?? null,
                    error: options.error ?? null,
                  };
                },
              };
            },
          };
        },
        select(columns: string) {
          calls.push({ table, operation: "select", payload: columns });
          return {
            eq(column: string, value: string) {
              calls.push({
                table,
                operation: "select.eq",
                match: { [column]: value },
              });
              const query = {
                eq(nextColumn: string, nextValue: string) {
                  calls.push({
                    table,
                    operation: "select.eq",
                    match: { [nextColumn]: nextValue },
                  });
                  return {
                    async maybeSingle() {
                      return {
                        data: options.getData ?? null,
                        error: options.error ?? null,
                      };
                    },
                  };
                },
                order(column: string, orderOptions: unknown) {
                  calls.push({
                    table,
                    operation: "select.order",
                    payload: column,
                    options: orderOptions,
                  });
                  return {
                    async limit(count: number) {
                      calls.push({
                        table,
                        operation: "select.limit",
                        payload: count,
                      });
                      return {
                        data: options.listData ?? [],
                        error: options.error ?? null,
                      };
                    },
                  };
                },
              };
              return query;
            },
          };
        },
      };
    },
  };
}

beforeEach(() => {
  mocks.getWorkbenchSupabase.mockReset();
});

describe("Workbench run history helpers", () => {
  it("persists the successful run payload into workbench_run_history", async () => {
    const supabase = createSupabaseDouble({ insertData: storedRun });
    mocks.getWorkbenchSupabase.mockReturnValue(supabase);

    const outcome = await persistWorkbenchRun({
      userId: "principal_123",
      ask: "Help me reply to the client",
      result,
      retrieval,
      invocation,
    });

    expect(outcome).toEqual({ status: "stored", run: storedRun });
    expect(supabase.calls).toContainEqual({
      table: "workbench_run_history",
      operation: "insert",
      payload: {
        user_id: "principal_123",
        ask: "Help me reply to the client",
        result,
        retrieval,
        invocation,
      },
    });
  });

  it("returns unavailable instead of throwing when Supabase is missing", async () => {
    mocks.getWorkbenchSupabase.mockReturnValue(null);

    await expect(
      persistWorkbenchRun({
        userId: "principal_123",
        ask: "Help me reply to the client",
        result,
        retrieval,
        invocation,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      error: "workbench_run_history_unavailable",
    });

    await expect(listWorkbenchRuns({ userId: "principal_123" })).resolves.toEqual({
      status: "unavailable",
      runs: [],
      error: "workbench_run_history_unavailable",
    });
  });

  it("lists recent runs scoped to one user and ordered newest first", async () => {
    const supabase = createSupabaseDouble({ listData: [storedRun] });
    mocks.getWorkbenchSupabase.mockReturnValue(supabase);

    const outcome = await listWorkbenchRuns({
      userId: "principal_123",
      limit: 10,
    });

    expect(outcome).toEqual({ status: "ok", runs: [storedRun] });
    expect(supabase.calls).toContainEqual({
      table: "workbench_run_history",
      operation: "select.eq",
      match: { user_id: "principal_123" },
    });
    expect(supabase.calls).toContainEqual({
      table: "workbench_run_history",
      operation: "select.order",
      payload: "created_at",
      options: { ascending: false },
    });
    expect(supabase.calls).toContainEqual({
      table: "workbench_run_history",
      operation: "select.limit",
      payload: 10,
    });
  });

  it("gets a single run by id only when it belongs to the user", async () => {
    const supabase = createSupabaseDouble({ getData: storedRun });
    mocks.getWorkbenchSupabase.mockReturnValue(supabase);

    const outcome = await getWorkbenchRun({
      userId: "principal_123",
      id: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome).toEqual({ status: "ok", run: storedRun });
    expect(supabase.calls).toContainEqual({
      table: "workbench_run_history",
      operation: "select.eq",
      match: { id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(supabase.calls).toContainEqual({
      table: "workbench_run_history",
      operation: "select.eq",
      match: { user_id: "principal_123" },
    });
  });
});
