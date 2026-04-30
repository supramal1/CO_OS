import { describe, expect, it, vi } from "vitest";
import {
  classifyWorkbenchLearningCandidate,
  classifyAndPersistWorkbenchLearningCandidate,
  createSupabaseWorkbenchProfileUpdateStore,
  extractWorkbenchLearningCandidatesFromRun,
  markWorkbenchProfileUpdateUndone,
  processWorkbenchRunLearning,
  persistWorkbenchProfileUpdate,
  WORKBENCH_PROFILE_UPDATE_STATUSES,
  type WorkbenchProfileUpdateInsertPayload,
  type WorkbenchProfileUpdateRow,
  type WorkbenchProfileUpdateStore,
  type WorkbenchProfileUpdateUndoPayload,
  type WorkbenchLearningCandidate,
} from "@/lib/workbench/learning";
import type { WorkbenchPreflightResult } from "@/lib/workbench/types";

type SupabaseCall = {
  table: string;
  operation: string;
  payload?: unknown;
  match?: Record<string, string>;
};

function createSupabaseDouble(options: {
  insertData?: WorkbenchProfileUpdateRow | null;
  updateData?: WorkbenchProfileUpdateRow | null;
  error?: { message?: string } | null;
}) {
  const calls: SupabaseCall[] = [];

  return {
    calls,
    from(table: string) {
      return {
        insert(payload: WorkbenchProfileUpdateInsertPayload) {
          calls.push({ table, operation: "insert", payload });
          return {
            select(columns: string) {
              calls.push({
                table,
                operation: "insert.select",
                payload: columns,
              });
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
        update(payload: WorkbenchProfileUpdateUndoPayload) {
          calls.push({ table, operation: "update", payload });
          return {
            eq(column: string, value: string) {
              calls.push({
                table,
                operation: "update.eq",
                match: { [column]: value },
              });
              return {
                eq(nextColumn: string, nextValue: string) {
                  calls.push({
                    table,
                    operation: "update.eq",
                    match: { [nextColumn]: nextValue },
                  });
                  return {
                    select(columns: string) {
                      calls.push({
                        table,
                        operation: "update.select",
                        payload: columns,
                      });
                      return {
                        async single() {
                          return {
                            data: options.updateData ?? null,
                            error: options.error ?? null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

const safeVoiceCandidate: WorkbenchLearningCandidate = {
  target_page: "Voice",
  candidate_text: "Prefers short, direct bullets for client follow-ups.",
  source_run_id: "run-1",
  evidence_count: 2,
};

describe("Workbench learning classifier", () => {
  it("writes compact durable preferences and current work signals", async () => {
    await expect(
      classifyWorkbenchLearningCandidate(safeVoiceCandidate),
    ).resolves.toMatchObject({
      decision: "write",
      target_page: "Voice",
      candidate_text: "Prefers short, direct bullets for client follow-ups.",
    });

    await expect(
      classifyWorkbenchLearningCandidate({
        target_page: "Working On",
        candidate_text: "Currently working on the Q2 retail search plan.",
        evidence_count: 1,
      }),
    ).resolves.toMatchObject({
      decision: "write",
      target_page: "Working On",
    });
  });

  it("holds useful-but-weak pattern signals until there is more evidence", async () => {
    await expect(
      classifyWorkbenchLearningCandidate({
        target_page: "Patterns",
        candidate_text: "Competitor scans help before strategic response drafts.",
        evidence_count: 1,
      }),
    ).resolves.toMatchObject({
      decision: "needs_more_evidence",
      reason: "pattern_needs_repeated_evidence",
    });
  });

  it("skips sensitive, speculative, negative, and one-off details", async () => {
    const candidates: WorkbenchLearningCandidate[] = [
      {
        target_page: "Personal Profile",
        candidate_text: "User has a medical appointment next week.",
      },
      {
        target_page: "Voice",
        candidate_text: "Maybe Priya hates long decks.",
      },
      {
        target_page: "Patterns",
        candidate_text: "The Acme deck is due tomorrow.",
      },
    ];

    await Promise.all(
      candidates.map(async (candidate) => {
        await expect(classifyWorkbenchLearningCandidate(candidate)).resolves.toEqual(
          expect.objectContaining({ decision: "skip" }),
        );
      }),
    );
  });

  it("supports injected model classification but keeps deterministic guardrails", async () => {
    const modelClassifier = vi.fn(async () => ({
      decision: "write" as const,
      reason: "model_safe",
      confidence: 0.91,
    }));

    await expect(
      classifyWorkbenchLearningCandidate(safeVoiceCandidate, { modelClassifier }),
    ).resolves.toMatchObject({
      decision: "write",
      reason: "model_safe",
      model_used: true,
    });

    await expect(
      classifyWorkbenchLearningCandidate(
        {
          target_page: "Personal Profile",
          candidate_text: "User is anxious about performance feedback.",
        },
        { modelClassifier },
      ),
    ).resolves.toMatchObject({
      decision: "skip",
      model_used: true,
    });
  });
});

describe("Workbench learning extraction", () => {
  it("extracts conservative candidates from a successful run without mail-send actions", () => {
    const result: WorkbenchPreflightResult = {
      decoded_task: {
        summary: "Draft a concise client response",
        requester: "Client",
        deliverable_type: "written_response",
        task_type: "draft_check",
      },
      missing_context: [],
      drafted_clarifying_message: "",
      retrieved_context: [],
      suggested_approach: [
        {
          step: "Use direct bullets",
          rationale: "The ask explicitly says the user prefers direct bullets.",
        },
      ],
      time_estimate: {
        estimated_before_minutes: 30,
        estimated_workbench_minutes: 10,
        task_type: "draft_check",
      },
      warnings: [],
    };

    const candidates = extractWorkbenchLearningCandidatesFromRun({
      ask: "I prefer direct bullets. I am working on the Q2 retail search plan.",
      result,
      sourceRunId: "run-1",
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        target_page: "Voice",
        candidate_text: "Prefers direct bullets.",
      }),
      expect.objectContaining({
        target_page: "Working On",
        candidate_text: "Currently working on the Q2 retail search plan.",
      }),
    ]);
    expect(JSON.stringify(candidates)).not.toMatch(/mail_send|compose_email/i);
  });
});

describe("Workbench profile update persistence", () => {
  it("persists profile update provenance through the Supabase store boundary", async () => {
    const storedRow: WorkbenchProfileUpdateRow = {
      id: "update-1",
      user_id: "principal_123",
      target_page: "Voice",
      source_run_id: "run-1",
      candidate_text: "Prefers short, direct bullets for client follow-ups.",
      status: "pending",
      classification: { decision: "write" },
      notion_page_id: null,
      notion_block_id: null,
      undo_of_update_id: null,
      undo_reason: null,
      undo_metadata: null,
      undone_at: null,
      created_at: "2026-04-30T10:00:00.000Z",
      updated_at: "2026-04-30T10:00:00.000Z",
    };
    const supabase = createSupabaseDouble({ insertData: storedRow });
    const store = createSupabaseWorkbenchProfileUpdateStore(supabase);

    const outcome = await persistWorkbenchProfileUpdate(
      {
        userId: "principal_123",
        targetPage: "Voice",
        sourceRunId: "run-1",
        candidateText: "Prefers short, direct bullets for client follow-ups.",
        status: "pending",
        classification: { decision: "write" },
      },
      { store },
    );

    expect(outcome).toEqual({ status: "stored", update: storedRow });
    expect(supabase.calls).toContainEqual({
      table: "workbench_profile_updates",
      operation: "insert",
      payload: {
        user_id: "principal_123",
        target_page: "Voice",
        source_run_id: "run-1",
        candidate_text: "Prefers short, direct bullets for client follow-ups.",
        status: "pending",
        classification: { decision: "write" },
        notion_page_id: null,
        notion_block_id: null,
        undo_of_update_id: null,
        undo_reason: null,
        undo_metadata: null,
        undone_at: null,
      },
    });
  });

  it("classifies and stores skipped candidates as provenance instead of writing", async () => {
    const store: WorkbenchProfileUpdateStore = {
      insertProfileUpdate: vi.fn(async (payload) => ({
        id: "update-2",
        ...payload,
        created_at: "2026-04-30T10:00:00.000Z",
        updated_at: "2026-04-30T10:00:00.000Z",
      })),
      markProfileUpdateUndone: vi.fn(),
    };

    const outcome = await classifyAndPersistWorkbenchLearningCandidate(
      {
        userId: "principal_123",
        candidate: {
          target_page: "Personal Profile",
          candidate_text: "User has a medical appointment tomorrow.",
          source_run_id: "run-2",
        },
      },
      { store },
    );

    expect(outcome.classification.decision).toBe("skip");
    expect(outcome.persistence.status).toBe("stored");
    expect(store.insertProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "skipped",
        candidate_text: "User has a medical appointment tomorrow.",
      }),
    );
  });

  it("marks updates undone with reversible metadata", async () => {
    const undoneRow: WorkbenchProfileUpdateRow = {
      id: "update-1",
      user_id: "principal_123",
      target_page: "Voice",
      source_run_id: "run-1",
      candidate_text: "Prefers short, direct bullets for client follow-ups.",
      status: "undone",
      classification: { decision: "write" },
      notion_page_id: "voice-page",
      notion_block_id: "block-1",
      undo_of_update_id: null,
      undo_reason: "User reverted latest profile update",
      undo_metadata: { reverted_by: "user" },
      undone_at: "2026-04-30T10:05:00.000Z",
      created_at: "2026-04-30T10:00:00.000Z",
      updated_at: "2026-04-30T10:05:00.000Z",
    };
    const supabase = createSupabaseDouble({ updateData: undoneRow });
    const store = createSupabaseWorkbenchProfileUpdateStore(supabase);

    const outcome = await markWorkbenchProfileUpdateUndone(
      {
        userId: "principal_123",
        updateId: "update-1",
        reason: "User reverted latest profile update",
        metadata: { reverted_by: "user" },
        undoneAt: "2026-04-30T10:05:00.000Z",
      },
      { store },
    );

    expect(outcome).toEqual({ status: "updated", update: undoneRow });
    expect(supabase.calls).toContainEqual({
      table: "workbench_profile_updates",
      operation: "update",
      payload: {
        status: "undone",
        undo_reason: "User reverted latest profile update",
        undo_metadata: { reverted_by: "user" },
        undone_at: "2026-04-30T10:05:00.000Z",
        updated_at: "2026-04-30T10:05:00.000Z",
      },
    });
  });

  it("keeps profile update statuses explicit and mail-action-free", () => {
    expect(WORKBENCH_PROFILE_UPDATE_STATUSES).toEqual([
      "pending",
      "written",
      "needs_more_evidence",
      "skipped",
      "undone",
      "error",
    ]);
    expect(WORKBENCH_PROFILE_UPDATE_STATUSES.join(" ")).not.toMatch(
      /mail_send|compose_email/i,
    );
  });
});

describe("Workbench run learning", () => {
  it("writes safe ask learning to Notion and stores provenance as written", async () => {
    const store: WorkbenchProfileUpdateStore = {
      insertProfileUpdate: vi.fn(async (payload) => ({
        id: "update-1",
        ...payload,
        created_at: "2026-04-30T10:00:00.000Z",
        updated_at: "2026-04-30T10:00:00.000Z",
      })),
      markProfileUpdateUndone: vi.fn(),
    };
    const appendCalls: Array<{ pageId: string; item: string }> = [];

    const result = await processWorkbenchRunLearning({
      userId: "principal_123",
      ask: "I prefer direct bullets for client follow-ups.",
      result: basePreflightResult(),
      sourceRunId: "run-1",
      config: { notion_parent_page_id: "parent-1" },
      store,
      now: new Date("2026-04-30T10:00:00.000Z"),
      writerClient: {
        async listChildPages() {
          return [{ id: "voice-page", title: "Voice" }];
        },
        async appendBlockChildren(pageId, blocks) {
          appendCalls.push({
            pageId,
            item:
              blocks[2]?.type === "bulleted_list_item"
                ? blocks[2].bulleted_list_item.rich_text[0].text.content
                : "",
          });
          return [];
        },
      },
    });

    expect(result).toEqual({
      status: "updated",
      targetLabel: "Voice",
      canUndo: true,
      updateId: "update-1",
    });
    expect(appendCalls).toEqual([
      {
        pageId: "voice-page",
        item: "Prefers direct bullets for client follow-ups.",
      },
    ]);
    expect(store.insertProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target_page: "Voice",
        source_run_id: "run-1",
        status: "written",
        notion_page_id: "voice-page",
      }),
    );
  });

  it("stores unsafe ask learning as skipped without writing to Notion", async () => {
    const store: WorkbenchProfileUpdateStore = {
      insertProfileUpdate: vi.fn(async (payload) => ({
        id: "update-2",
        ...payload,
        created_at: "2026-04-30T10:00:00.000Z",
        updated_at: "2026-04-30T10:00:00.000Z",
      })),
      markProfileUpdateUndone: vi.fn(),
    };
    const writerClient = {
      listChildPages: vi.fn(async () => [{ id: "voice-page", title: "Voice" }]),
      appendBlockChildren: vi.fn(async () => []),
    };

    const result = await processWorkbenchRunLearning({
      userId: "principal_123",
      ask: "I prefer direct bullets today.",
      result: basePreflightResult(),
      sourceRunId: "run-2",
      config: { notion_parent_page_id: "parent-1" },
      store,
      writerClient,
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "no_writable_learning_candidates",
    });
    expect(writerClient.appendBlockChildren).not.toHaveBeenCalled();
    expect(store.insertProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "skipped",
      }),
    );
  });
});

function basePreflightResult(): WorkbenchPreflightResult {
  return {
    decoded_task: {
      summary: "Draft a concise client response",
      requester: "Client",
      deliverable_type: "written_response",
      task_type: "draft_check",
    },
    missing_context: [],
    drafted_clarifying_message: "",
    retrieved_context: [],
    suggested_approach: [],
    time_estimate: {
      estimated_before_minutes: 30,
      estimated_workbench_minutes: 10,
      task_type: "draft_check",
    },
    warnings: [],
  };
}
