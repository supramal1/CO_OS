import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { buildPresendDriveArtifact } from "@/lib/workbench/presend-save-back";
import type { WorkbenchPresendResult } from "@/lib/workbench/presend-types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getWorkbenchSupabase: vi.fn(),
  getWorkbenchGoogleAuthReadiness: vi.fn(),
  getWorkbenchConnectorHealth: vi.fn(),
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

vi.mock("server-only", () => ({}));

vi.mock("@/lib/workbench/connector-health", () => ({
  getWorkbenchConnectorHealth: (...args: unknown[]) =>
    mocks.getWorkbenchConnectorHealth(...args),
}));

import { PATCH } from "@/app/api/workbench/config/route";
import { GET as checkWorkbench } from "@/app/api/workbench/check/route";
import { deriveWorkbenchConnectorSummary } from "@/components/workbench/workbench-shell";

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

const storedTokenMissingReadiness = {
  ready: false,
  status: "token_missing",
  required_scopes: [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/calendar.readonly",
  ],
  granted_scopes: [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/calendar.readonly",
  ],
  missing_scopes: [],
  blockers: ["google_stored_token_missing"],
};

const reconsentReadiness = {
  ready: false,
  status: "scope_missing",
  required_scopes: storedTokenMissingReadiness.required_scopes,
  granted_scopes: ["https://www.googleapis.com/auth/drive.file"],
  missing_scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/calendar.readonly",
  ],
  blockers: ["google_oauth_scope_missing"],
};

const savedConfig = {
  user_id: "principal_staff_1",
  notion_parent_page_id: "notion-parent",
  drive_folder_id: "drive-folder",
  drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
  google_oauth_grant_status: "granted",
  google_oauth_scopes: storedTokenMissingReadiness.required_scopes,
  voice_register: "direct",
  feedback_style: "specific",
  friction_tasks: ["status reports"],
};

const presendResult: WorkbenchPresendResult = {
  artifact_intent: {
    artifact_type: "docx_scaffold",
    title: "Client Follow Up",
    audience: "Client team",
    purpose: "Confirm decisions and next steps",
  },
  artifact_spec: {
    format: "markdown",
    sections: [
      { heading: "Decisions", purpose: "Capture decisions" },
      { heading: "Next steps", purpose: null },
    ],
    source_context: [
      {
        claim: "QBR decision owner is Morgan.",
        source_type: "notion",
        source_label: "QBR notes",
        source_url: "https://notion.test/qbr-notes",
      },
    ],
  },
  quality_checks: [{ check: "No unsupported claims", status: "pass", detail: null }],
  save_back_requirements: [
    {
      target: "drive",
      action: "save_artifact",
      required: true,
      reason: "Save staff artifact to Drive",
    },
  ],
  warnings: ["Confirm deadline before sharing."],
};

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getWorkbenchSupabase.mockReset();
  mocks.getWorkbenchGoogleAuthReadiness.mockReset();
  mocks.getWorkbenchConnectorHealth.mockReset();
  mocks.auth.mockResolvedValue({ principalId: "principal_staff_1" });
  mocks.getWorkbenchGoogleAuthReadiness.mockResolvedValue(storedTokenMissingReadiness);
});

describe("Workbench staff onboarding acceptance", () => {
  it("saves first-run setup through config PATCH without hardcoded user ids", async () => {
    const supabase = createSupabaseDouble({ savedConfig });
    mocks.getWorkbenchSupabase.mockReturnValue(supabase);

    const res = await PATCH(
      request({
        notion_parent_page_id: " notion-parent ",
        drive_folder_id: " drive-folder ",
        drive_folder_url:
          " https://drive.google.com/drive/folders/drive-folder ",
        voice_register: " direct ",
        feedback_style: " specific ",
        friction_tasks: ["status reports", "", 42],
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      config: savedConfig,
      google_readiness: storedTokenMissingReadiness,
    });
    expect(supabase.calls).toContainEqual({
      table: "user_workbench_config",
      operation: "upsert",
      payload: {
        payload: {
          user_id: "principal_staff_1",
          notion_parent_page_id: "notion-parent",
          drive_folder_id: "drive-folder",
          drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
          voice_register: "direct",
          feedback_style: "specific",
          friction_tasks: ["status reports"],
        },
        options: { onConflict: "user_id" },
      },
    });
  });

  it("returns notion, Google, calendar, and drive readiness checks with partial degradation", async () => {
    mocks.getWorkbenchConnectorHealth.mockResolvedValue({
      generated_at: "2026-04-29T12:00:00.000Z",
      checks: [
        { source: "config", status: "ready" },
        { source: "notion", status: "ready" },
        {
          source: "google",
          status: "unavailable",
          reason: "scope_missing",
          action: "google_reconsent",
        },
        {
          source: "calendar",
          status: "unavailable",
          reason: "google_oauth_scope_missing",
          action: "google_reconsent",
        },
        { source: "drive", status: "ready" },
      ],
    });

    const res = await checkWorkbench();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      generated_at: "2026-04-29T12:00:00.000Z",
      checks: [
        { source: "config", status: "ready" },
        { source: "notion", status: "ready" },
        {
          source: "google",
          status: "unavailable",
          reason: "scope_missing",
          action: "google_reconsent",
        },
        {
          source: "calendar",
          status: "unavailable",
          reason: "google_oauth_scope_missing",
          action: "google_reconsent",
        },
        { source: "drive", status: "ready" },
      ],
    });
    expect(mocks.getWorkbenchConnectorHealth).toHaveBeenCalledWith({
      userId: "principal_staff_1",
    });
  });

  it("marks the Workbench UI helper for Google re-consent when scopes are missing", () => {
    const summary = deriveWorkbenchConnectorSummary({
      status: "loaded",
      config: savedConfig,
      google_readiness: reconsentReadiness,
    });

    expect(summary.rows.find((row) => row.id === "google")).toMatchObject({
      status: "unavailable",
      detail: "scope_missing",
      action: "google_reconsent",
    });
  });

  it("builds presend save-back artifacts as readable Markdown", () => {
    const artifact = buildPresendDriveArtifact(presendResult);

    expect(artifact).toMatchObject({
      id: "presend-client-follow-up",
      name: "client-follow-up-presend.md",
      mimeType: "text/markdown",
    });
    expect(artifact.content).toContain("# Client Follow Up");
    expect(artifact.content).toContain("## Sections");
    expect(artifact.content).not.toContain('"artifact_intent"');
  });

  it("keeps Gmail references out of Workbench runtime", () => {
    const runtimeText = runtimeFiles([
      "app/api/workbench",
      "components/workbench",
      "lib/workbench",
    ])
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(runtimeText).not.toMatch(
      /\bgmail\b|googleapis\.com\/auth\/gmail|gmail\.compose|\bdrafts\b/i,
    );
  });
});

function runtimeFiles(relativeRoots: string[]): string[] {
  return relativeRoots.flatMap((root) =>
    filesUnder(path.join(process.cwd(), root)),
  );
}

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const fullPath = path.join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return filesUnder(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}
