import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getWorkbenchSupabase: vi.fn(),
  getWorkbenchGoogleAuthReadiness: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/workbench/supabase", () => ({
  getWorkbenchSupabase: () => mocks.getWorkbenchSupabase(),
}));

vi.mock("@/lib/workbench/google-auth", () => ({
  getWorkbenchGoogleAuthReadiness: (principalId: string) =>
    mocks.getWorkbenchGoogleAuthReadiness(principalId),
}));

import { GET, PATCH } from "@/app/api/workbench/config/route";
import { patchWorkbenchUserConfig } from "@/lib/workbench/user-config";

type SupabaseCall = {
  table: string;
  operation: string;
  payload?: unknown;
  match?: Record<string, string>;
};

function request(jsonBody: unknown): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}

function createSupabaseDouble(options: {
  existingConfig?: Record<string, unknown> | null;
  savedConfig?: Record<string, unknown>;
}) {
  const calls: SupabaseCall[] = [];
  const savedConfig = options.savedConfig ?? options.existingConfig ?? null;

  return {
    calls,
    from(table: string) {
      return {
        select(columns: string) {
          calls.push({ table, operation: "select", payload: columns });
          return {
            eq(column: string, value: string) {
              calls.push({
                table,
                operation: "select.eq",
                match: { [column]: value },
              });
              return {
                async maybeSingle() {
                  return { data: options.existingConfig ?? null, error: null };
                },
                async single() {
                  return { data: savedConfig, error: null };
                },
              };
            },
          };
        },
        upsert(payload: unknown, upsertOptions: unknown) {
          calls.push({
            table,
            operation: "upsert",
            payload: { payload, options: upsertOptions },
          });
          return {
            select(columns: string) {
              calls.push({ table, operation: "upsert.select", payload: columns });
              return {
                async single() {
                  return { data: savedConfig, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

const readiness = {
  ready: false,
  status: "token_persistence_missing",
  required_scopes: ["https://www.googleapis.com/auth/drive.file"],
  granted_scopes: ["https://www.googleapis.com/auth/drive.file"],
  missing_scopes: [],
  blockers: ["google_token_persistence_missing"],
};

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getWorkbenchSupabase.mockReset();
  mocks.getWorkbenchGoogleAuthReadiness.mockReset();
  mocks.getWorkbenchGoogleAuthReadiness.mockResolvedValue(readiness);
});

describe("/api/workbench/config", () => {
  it("rejects GET without an authenticated principal", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns the current config row and Google readiness for the session principal", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    const supabase = createSupabaseDouble({
      existingConfig: {
        user_id: "principal_123",
        notion_parent_page_id: "notion-parent",
        drive_folder_id: "drive-folder",
        drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
        voice_register: "direct",
        feedback_style: "concise",
        friction_tasks: ["status reports"],
      },
    });
    mocks.getWorkbenchSupabase.mockReturnValue(supabase);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      config: {
        user_id: "principal_123",
        notion_parent_page_id: "notion-parent",
        drive_folder_id: "drive-folder",
        drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
        voice_register: "direct",
        feedback_style: "concise",
        friction_tasks: ["status reports"],
      },
      google_readiness: readiness,
    });
    expect(supabase.calls).toContainEqual({
      table: "user_workbench_config",
      operation: "select.eq",
      match: { user_id: "principal_123" },
    });
    expect(mocks.getWorkbenchGoogleAuthReadiness).toHaveBeenCalledWith(
      "principal_123",
    );
  });

  it("returns 503 when Supabase config storage is unavailable", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.getWorkbenchSupabase.mockReturnValue(null);

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "workbench_config_unavailable" });
  });

  it("validates required config strings before PATCH upsert", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.getWorkbenchSupabase.mockReturnValue(createSupabaseDouble({}));

    const res = await PATCH(
      request({
        notion_parent_page_id: "notion-parent",
        drive_folder_id: "",
        drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_workbench_config",
      required: [
        "notion_parent_page_id",
        "drive_folder_id",
        "drive_folder_url",
      ],
    });
  });

  it("upserts PATCH config by session principal and returns saved config with readiness", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    const savedConfig = {
      user_id: "principal_123",
      notion_parent_page_id: "notion-parent",
      drive_folder_id: "drive-folder",
      drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
      voice_register: "calm",
      feedback_style: "specific",
      friction_tasks: ["copy paste"],
    };
    const supabase = createSupabaseDouble({ savedConfig });
    mocks.getWorkbenchSupabase.mockReturnValue(supabase);

    const res = await PATCH(
      request({
        notion_parent_page_id: " notion-parent ",
        drive_folder_id: " drive-folder ",
        drive_folder_url:
          " https://drive.google.com/drive/folders/drive-folder ",
        voice_register: " calm ",
        feedback_style: " specific ",
        friction_tasks: ["copy paste", 12, ""],
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      config: savedConfig,
      google_readiness: readiness,
    });
    expect(supabase.calls).toContainEqual({
      table: "user_workbench_config",
      operation: "upsert",
      payload: {
        payload: {
          user_id: "principal_123",
          notion_parent_page_id: "notion-parent",
          drive_folder_id: "drive-folder",
          drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
          voice_register: "calm",
          feedback_style: "specific",
          friction_tasks: ["copy paste"],
        },
        options: { onConflict: "user_id" },
      },
    });
  });

  it("upserts partial connector setup without requiring every connector field", async () => {
    const savedConfig = {
      user_id: "principal_123",
      notion_parent_page_id: "notion-parent",
      drive_folder_id: null,
      drive_folder_url: null,
      google_oauth_grant_status: "pending",
      google_oauth_scopes: [],
    };
    const supabase = createSupabaseDouble({ savedConfig });
    mocks.getWorkbenchSupabase.mockReturnValue(supabase);

    const result = await patchWorkbenchUserConfig("principal_123", {
      notion_parent_page_id: " notion-parent ",
    });

    expect(result).toMatchObject({ status: "ok", config: savedConfig });
    expect(supabase.calls).toContainEqual({
      table: "user_workbench_config",
      operation: "upsert",
      payload: {
        payload: expect.objectContaining({
          user_id: "principal_123",
          notion_parent_page_id: "notion-parent",
        }),
        options: { onConflict: "user_id" },
      },
    });
  });
});
