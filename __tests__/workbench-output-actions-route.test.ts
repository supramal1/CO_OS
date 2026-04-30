import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getWorkbenchSupabase: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/workbench/supabase", () => ({
  getWorkbenchSupabase: () => mocks.getWorkbenchSupabase(),
}));

import { POST } from "@/app/api/workbench/actions/route";

type SupabaseCall = {
  table: string;
  operation: string;
  payload?: unknown;
};

function request(jsonBody: unknown): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}

function badJsonRequest(): NextRequest {
  return {
    json: async () => {
      throw new Error("bad json");
    },
  } as unknown as NextRequest;
}

function createFeedbackSupabaseDouble(options?: {
  insertError?: { message: string } | null;
}) {
  const calls: SupabaseCall[] = [];

  return {
    calls,
    from(table: string) {
      return {
        async insert(payload: unknown) {
          calls.push({ table, operation: "insert", payload });
          return { error: options?.insertError ?? null };
        },
      };
    },
  };
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getWorkbenchSupabase.mockReset();
});

describe("POST /api/workbench/actions", () => {
  it("rejects unauthenticated staff", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await POST(request({ action: "copy_response" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("rejects invalid JSON", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });

    const res = await POST(badJsonRequest());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("rejects invalid actions with the typed V1 action list", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });

    const res = await POST(request({ action: "send_to_gmail" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_action",
      valid_actions: [
        "copy_response",
        "save_to_drive",
        "save_to_notion",
        "feedback_useful",
        "feedback_not_useful",
      ],
    });
  });

  it("accepts copy_response as a client-side action marker", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });

    const res = await POST(
      request({
        action: "copy_response",
        run_id: " run-123 ",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      action: "copy_response",
      status: "accepted",
      reason: "client_side_action",
      run_id: "run-123",
    });
  });

  it("accepts save_to_drive as a presend save-back compatible placeholder", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });

    const res = await POST(
      request({
        action: "save_to_drive",
        run_id: "run-123",
        payload: {
          save_back: {
            status: "saved",
            target: "drive",
            source: {
              provider: "google_drive",
              status: "available",
              fileId: "file-123",
              folderId: "folder-123",
              name: "client-follow-up-presend.md",
              mimeType: "text/markdown",
              webUrl: "https://drive.google.com/file/d/file-123/view",
            },
          },
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      action: "save_to_drive",
      status: "accepted",
      reason: "drive_save_back_contract_accepted",
      run_id: "run-123",
      save_back: {
        status: "saved",
        target: "drive",
        source: {
          provider: "google_drive",
          status: "available",
          fileId: "file-123",
          folderId: "folder-123",
          name: "client-follow-up-presend.md",
          mimeType: "text/markdown",
          webUrl: "https://drive.google.com/file/d/file-123/view",
        },
      },
    });
  });

  it("returns unavailable for save_to_notion in V1", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });

    const res = await POST(
      request({ action: "save_to_notion", run_id: "run-123" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      action: "save_to_notion",
      status: "unavailable",
      reason: "notion_save_back_not_supported_v1",
      run_id: "run-123",
    });
  });

  it("persists useful feedback when storage exists", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    const supabase = createFeedbackSupabaseDouble();
    mocks.getWorkbenchSupabase.mockReturnValue(supabase);

    const res = await POST(
      request({
        action: "feedback_useful",
        run_id: "run-123",
        payload: { note: "Kept the source context tight." },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      action: "feedback_useful",
      status: "accepted",
      reason: "feedback_recorded",
      run_id: "run-123",
      persisted: true,
    });
    expect(supabase.calls).toEqual([
      {
        table: "workbench_output_feedback",
        operation: "insert",
        payload: expect.objectContaining({
          user_id: "principal_123",
          run_id: "run-123",
          action: "feedback_useful",
          sentiment: "useful",
          payload: { note: "Kept the source context tight." },
        }),
      },
    ]);
  });

  it("accepts not-useful feedback as noop when feedback storage is unavailable", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.getWorkbenchSupabase.mockReturnValue(null);

    const res = await POST(
      request({
        action: "feedback_not_useful",
        run_id: "run-123",
        payload: { reason: "Too generic." },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      action: "feedback_not_useful",
      status: "accepted",
      reason: "feedback_storage_unavailable",
      run_id: "run-123",
      persisted: false,
    });
  });
});
