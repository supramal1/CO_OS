import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { WorkbenchArtifact } from "@/lib/workbench/save-back";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getWorkbenchSupabase: vi.fn(),
  getWorkbenchGoogleAuthReadiness: vi.fn(),
  loadWorkbenchSkill: vi.fn(),
  anthropicCreate: vi.fn(),
  persistWorkbenchInvocation: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/workbench/supabase", () => ({
  getWorkbenchSupabase: () => mocks.getWorkbenchSupabase(),
}));

vi.mock("@/lib/workbench/google-auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workbench/google-auth")>();
  return {
    ...actual,
    getWorkbenchGoogleAuthReadiness: (principalId: string) =>
      mocks.getWorkbenchGoogleAuthReadiness(principalId),
  };
});

vi.mock("@/lib/workbench/skill-loader", () => ({
  loadWorkbenchSkill: (...args: unknown[]) => mocks.loadWorkbenchSkill(...args),
}));

vi.mock("@/lib/workbench/persistence", () => ({
  persistWorkbenchInvocation: (...args: unknown[]) =>
    mocks.persistWorkbenchInvocation(...args),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = {
      create: (...args: unknown[]) => mocks.anthropicCreate(...args),
    };
  },
}));

import { PATCH as saveWorkbenchConfig } from "@/app/api/workbench/config/route";
import { getWorkbenchConnectorHealth } from "@/lib/workbench/connector-health";
import { gatherWorkbenchRetrieval } from "@/lib/workbench/retrieval";
import { runWorkbenchPresend } from "@/lib/workbench/presend-start";
import {
  WORKBENCH_GOOGLE_CONNECTOR_SCOPES,
  type WorkbenchGoogleAuthReadiness,
} from "@/lib/workbench/google-auth";

type SupabaseCall = {
  table: string;
  operation: string;
  payload?: unknown;
  match?: Record<string, string>;
};

const staffConfig = {
  user_id: "principal_staff_1",
  notion_parent_page_id: "notion-parent",
  drive_folder_id: "drive-folder",
  drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
  google_oauth_grant_status: "granted",
  google_oauth_scopes: [...WORKBENCH_GOOGLE_CONNECTOR_SCOPES],
  voice_register: "direct",
  feedback_style: "specific",
  friction_tasks: ["status reports"],
};

const googleReady = {
  ready: true,
  status: "ready",
  required_scopes: [...WORKBENCH_GOOGLE_CONNECTOR_SCOPES],
  granted_scopes: [...WORKBENCH_GOOGLE_CONNECTOR_SCOPES],
  missing_scopes: [],
  blockers: [],
} satisfies WorkbenchGoogleAuthReadiness;

const preflightResult = {
  decoded_task: {
    summary: "Prepare the Nike QBR follow-up",
    requester: "Ops",
    deliverable_type: "written_response",
    task_type: "draft_check",
  },
  missing_context: [],
  drafted_clarifying_message: "",
  retrieved_context: [
    {
      claim: "Voice: Use short, direct updates.",
      source_type: "notion",
      source_label: "Notion: Voice",
      source_url: null,
    },
  ],
  suggested_approach: [],
  time_estimate: {
    estimated_before_minutes: 35,
    estimated_workbench_minutes: 12,
    task_type: "draft_check",
  },
  warnings: [],
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

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getWorkbenchSupabase.mockReset();
  mocks.getWorkbenchGoogleAuthReadiness.mockReset();
  mocks.loadWorkbenchSkill.mockReset();
  mocks.anthropicCreate.mockReset();
  mocks.persistWorkbenchInvocation.mockReset();
  mocks.auth.mockResolvedValue({
    apiKey: "csk_staff",
    principalId: "principal_staff_1",
  });
  mocks.getWorkbenchGoogleAuthReadiness.mockResolvedValue(googleReady);
  mocks.loadWorkbenchSkill.mockResolvedValue({
    name: "workbench-presend",
    version: "0.1.0",
    content: "PRESEND SYSTEM PROMPT",
  });
  mocks.persistWorkbenchInvocation.mockResolvedValue(undefined);
});

describe("Workbench live staff path", () => {
  it("saves config, checks connectors, retrieves Notion and Calendar, and saves Drive output without Gmail", async () => {
    const supabase = createSupabaseDouble({ savedConfig: staffConfig });
    mocks.getWorkbenchSupabase.mockReturnValue(supabase);

    const configResponse = await saveWorkbenchConfig(
      request({
        notion_parent_page_id: " notion-parent ",
        drive_folder_id: " drive-folder ",
        drive_folder_url: " https://drive.google.com/drive/folders/drive-folder ",
        voice_register: " direct ",
        feedback_style: " specific ",
        friction_tasks: ["status reports"],
      }),
    );

    expect(configResponse.status).toBe(200);
    await expect(configResponse.json()).resolves.toEqual({
      config: staffConfig,
      google_readiness: googleReady,
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

    const health = await getWorkbenchConnectorHealth({
      userId: "principal_staff_1",
      now: new Date("2026-04-29T12:00:00.000Z"),
      deps: {
        getUserConfig: async () => staffConfig,
        getGoogleReadiness: async () => googleReady,
        retrieveNotionContext: async () => ({
          items: [],
          status: { source: "notion", status: "ok", items_count: 5 },
        }),
        googleAccessTokenProvider: async () => ({
          status: "available",
          accessToken: "google-token",
        }),
        createCalendarClient: () => ({
          status: "available",
          client: { searchEvents: async () => [] },
        }),
        checkDriveFolder: async () => ({ source: "drive", status: "ready" }),
      },
    });

    expect(health.checks).toEqual([
      { source: "config", status: "ready" },
      { source: "notion", status: "ready" },
      { source: "google", status: "ready" },
      { source: "calendar", status: "ready" },
      { source: "drive", status: "ready" },
    ]);

    const originalNotionToken = process.env.NOTION_API_TOKEN;
    process.env.NOTION_API_TOKEN = "notion-token";
    vi.stubGlobal("fetch", async (url: string | URL) => {
      const path = String(url);
      if (path.includes("/v1/blocks/notion-parent/children")) {
        return Response.json({
          results: [
            {
              id: "voice-page",
              type: "child_page",
              child_page: { title: "Voice" },
            },
          ],
        });
      }
      if (path.includes("/v1/blocks/voice-page/children")) {
        return Response.json({
          results: [
            {
              id: "voice-copy",
              type: "paragraph",
              paragraph: {
                rich_text: [{ plain_text: "Use short, direct updates." }],
              },
            },
          ],
        });
      }
      return Response.json({ results: [] });
    });

    try {
      const retrieval = await gatherWorkbenchRetrieval({
        ask: "Prepare the Nike QBR follow-up",
        userId: "principal_staff_1",
        apiKey: "csk_staff",
        config: staffConfig,
        now: new Date("2026-04-29T12:00:00.000Z"),
        adapters: {
          cornerstone: async () => ({
            items: [],
            status: {
              source: "cornerstone",
              status: "ok",
              items_count: 0,
            },
          }),
        },
        googleAccessTokenProvider: async () => ({
          status: "available",
          accessToken: "calendar-token",
        }),
        calendarFetch: async (url) => {
          const requestUrl = new URL(String(url));
          return Response.json({
            items:
              requestUrl.searchParams.get("q") === "Nike"
                ? [
                    {
                      id: "calendar-event-1",
                      summary: "Nike QBR prep",
                      htmlLink:
                        "https://calendar.google.com/event?eid=calendar-event-1",
                      start: { dateTime: "2026-05-04T09:00:00.000Z" },
                      end: { dateTime: "2026-05-04T09:30:00.000Z" },
                    },
                  ]
                : [],
          });
        },
      });

      expect(retrieval.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "notion",
            status: "available",
            items: [
              expect.objectContaining({
                source_type: "notion",
                source_label: "Notion: Voice",
                claim: "Voice: Use short, direct updates.",
              }),
            ],
          }),
          expect.objectContaining({
            source: "calendar",
            status: "available",
            items: [
              expect.objectContaining({
                source_type: "calendar",
                source_label: "Nike QBR prep",
              }),
            ],
          }),
        ]),
      );
    } finally {
      if (originalNotionToken === undefined) {
        delete process.env.NOTION_API_TOKEN;
      } else {
        process.env.NOTION_API_TOKEN = originalNotionToken;
      }
      vi.unstubAllGlobals();
    }

    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            artifact_intent: {
              artifact_type: "docx_scaffold",
              title: "Nike QBR Follow Up",
              audience: "Client team",
              purpose: "Confirm next steps",
            },
            artifact_spec: {
              format: "markdown",
              sections: [{ heading: "Next steps", purpose: "Assign owners" }],
              source_context: preflightResult.retrieved_context,
            },
            quality_checks: [
              { check: "Source-backed claims only", status: "pass", detail: null },
            ],
            save_back_requirements: [
              {
                target: "drive",
                action: "save_artifact",
                required: true,
                reason: "Save staff artifact to Drive",
              },
            ],
            warnings: [],
          }),
        },
      ],
    });
    const uploads: Array<{ artifact: WorkbenchArtifact; folderId: string }> = [];
    const presend = await runWorkbenchPresend({
      preflightResult,
      draftInput: "Draft the Nike QBR follow-up.",
      artifactSpecInput: "Create a readable save-back artifact.",
      userId: "principal_staff_1",
      apiKey: "csk_staff",
      anthropicApiKey: "anthropic-test",
      getUserConfig: async () => staffConfig,
      googleAccessTokenProvider: async () => ({
        status: "available",
        accessToken: "drive-token",
      }),
      createDriveUploader: () => ({
        status: "available",
        folderId: "drive-folder",
        uploader: async (input) => {
          uploads.push(input);
          return {
            fileId: "drive-file-1",
            webUrl: "https://drive.google.com/file/d/drive-file-1/view",
          };
        },
      }),
    });

    expect(presend.save_back).toMatchObject({
      status: "saved",
      target: "drive",
      source: {
        provider: "google_drive",
        fileId: "drive-file-1",
        folderId: "drive-folder",
        name: "nike-qbr-follow-up-presend.md",
        mimeType: "text/markdown",
      },
    });
    expect(uploads).toHaveLength(1);

    const matches = workbenchRuntimeFiles().flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [
        ...text.matchAll(
          /gmail|googleapis\.com\/auth\/gmail|gmail\.compose|drafts/gi,
        ),
      ].map((match) => `${relative(process.cwd(), file)}:${match[0]}`);
    });
    expect(matches).toEqual([]);
  });
});

function workbenchRuntimeFiles(): string[] {
  return ["lib/workbench", "app/api/workbench", "components/workbench"].flatMap(
    (dir) => listFiles(join(process.cwd(), dir)),
  );
}

function listFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path).flatMap((entry) => listFiles(join(path, entry)));
}
