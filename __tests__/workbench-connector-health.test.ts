import { describe, expect, it } from "vitest";
import {
  checkDriveFolderCapability,
  getWorkbenchConnectorHealth,
  type WorkbenchConnectorHealthDependencies,
} from "@/lib/workbench/connector-health";
import type { WorkbenchUserConfig } from "@/lib/workbench/retrieval/types";

const config: WorkbenchUserConfig = {
  user_id: "principal_123",
  notion_parent_page_id: "notion-parent",
  drive_folder_id: "drive-folder",
  drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
  google_oauth_grant_status: "granted",
  google_oauth_scopes: [],
  voice_register: null,
  feedback_style: null,
  friction_tasks: null,
};

const readyDeps: WorkbenchConnectorHealthDependencies = {
  getUserConfig: async () => config,
  getGoogleReadiness: async () => ({
    ready: true,
    status: "ready",
    required_scopes: [],
    granted_scopes: [],
    missing_scopes: [],
    blockers: [],
  }),
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
    client: {
      searchEvents: async () => [],
    },
  }),
  checkDriveFolder: async () => ({
    status: "ready",
    source: "drive",
  }),
};

describe("Workbench connector health", () => {
  it("returns ready checks for configured Notion, Google, Calendar, and Drive", async () => {
    const result = await getWorkbenchConnectorHealth({
      userId: "principal_123",
      now: new Date("2026-04-29T12:00:00.000Z"),
      deps: readyDeps,
    });

    expect(result).toEqual({
      generated_at: "2026-04-29T12:00:00.000Z",
      checks: [
        { source: "config", status: "ready" },
        { source: "notion", status: "ready" },
        { source: "google", status: "ready" },
        { source: "calendar", status: "ready" },
        { source: "drive", status: "ready" },
      ],
    });
  });

  it("degrades missing config and token states to unavailable checks", async () => {
    const result = await getWorkbenchConnectorHealth({
      userId: "principal_123",
      now: new Date("2026-04-29T12:00:00.000Z"),
      deps: {
        ...readyDeps,
        getUserConfig: async () => null,
        getGoogleReadiness: async () => ({
          ready: false,
          status: "grant_missing",
          required_scopes: [],
          granted_scopes: [],
          missing_scopes: [],
          blockers: ["google_oauth_grant_missing"],
        }),
        googleAccessTokenProvider: async () => ({
          status: "unavailable",
          reason: "google_refresh_token_missing",
        }),
      },
    });

    expect(result.checks).toEqual([
      {
        source: "config",
        status: "unavailable",
        reason: "user_workbench_config_missing",
      },
      {
        source: "notion",
        status: "unavailable",
        reason: "user_workbench_config_missing",
      },
      {
        source: "google",
        status: "reauth_required",
        reason: "grant_missing",
        blockers: ["google_oauth_grant_missing"],
        action: "google_reconsent",
      },
      {
        source: "calendar",
        status: "reauth_required",
        reason: "google_oauth_grant_missing",
        action: "google_reconsent",
      },
      {
        source: "drive",
        status: "unavailable",
        reason: "user_workbench_config_missing",
      },
    ]);
  });

  it("classifies Notion auth, parent, and child page setup states", async () => {
    const baseInput = {
      userId: "principal_123",
      now: new Date("2026-04-29T12:00:00.000Z"),
    };

    await expect(
      getWorkbenchConnectorHealth({
        ...baseInput,
        deps: {
          ...readyDeps,
          retrieveNotionContext: async () => ({
            items: [],
            status: {
              source: "notion",
              status: "unavailable",
              reason: "notion_api_token_missing",
              items_count: 0,
            },
          }),
        },
      }).then((result) => result.checks.find((check) => check.source === "notion")),
    ).resolves.toEqual({
      source: "notion",
      status: "unavailable",
      reason: "notion_api_token_missing",
    });

    await expect(
      getWorkbenchConnectorHealth({
        ...baseInput,
        deps: {
          ...readyDeps,
          retrieveNotionContext: async () => ({
            items: [],
            status: {
              source: "notion",
              status: "error",
              reason: "Notion API request failed with status 401",
              items_count: 0,
            },
          }),
        },
      }).then((result) => result.checks.find((check) => check.source === "notion")),
    ).resolves.toEqual({
      source: "notion",
      status: "reauth_required",
      reason: "notion_reauth_required",
      message: "Notion API request failed with status 401",
    });

    await expect(
      getWorkbenchConnectorHealth({
        ...baseInput,
        deps: {
          ...readyDeps,
          retrieveNotionContext: async () => ({
            items: [],
            status: {
              source: "notion",
              status: "error",
              reason: "Notion API request failed with status 404",
              items_count: 0,
            },
          }),
        },
      }).then((result) => result.checks.find((check) => check.source === "notion")),
    ).resolves.toEqual({
      source: "notion",
      status: "resource_missing",
      reason: "notion_parent_page_missing",
      message: "Notion API request failed with status 404",
    });

    await expect(
      getWorkbenchConnectorHealth({
        ...baseInput,
        deps: {
          ...readyDeps,
          retrieveNotionContext: async () => ({
            items: [],
            status: {
              source: "notion",
              status: "ok",
              items_count: 3,
            },
          }),
        },
      }).then((result) => result.checks.find((check) => check.source === "notion")),
    ).resolves.toEqual({
      source: "notion",
      status: "repair_available",
      reason: "notion_child_pages_missing",
      blockers: ["notion_child_pages_missing"],
      message: "Expected 5 Notion child pages, found 3.",
    });
  });

  it("classifies Google Drive auth, folder, repair, and ready states", async () => {
    const result = await getWorkbenchConnectorHealth({
      userId: "principal_123",
      now: new Date("2026-04-29T12:00:00.000Z"),
      deps: {
        ...readyDeps,
        googleAccessTokenProvider: async () => ({
          status: "unavailable",
          reason: "google_refresh_token_missing",
        }),
      },
    });

    expect(result.checks.find((check) => check.source === "drive")).toEqual({
      source: "drive",
      status: "reauth_required",
      reason: "google_refresh_token_missing",
      action: "google_reconsent",
    });

    const missingFolder = await getWorkbenchConnectorHealth({
      userId: "principal_123",
      now: new Date("2026-04-29T12:00:00.000Z"),
      deps: {
        ...readyDeps,
        getUserConfig: async () => ({
          ...config,
          drive_folder_id: "",
          drive_folder_url: "",
        }),
      },
    });

    expect(missingFolder.checks.find((check) => check.source === "drive")).toEqual({
      source: "drive",
      status: "repair_available",
      reason: "missing_drive_folder",
      blockers: ["drive_folder_id_missing"],
    });
  });

  it("keeps Calendar health auth-based without Gmail wording", async () => {
    const result = await getWorkbenchConnectorHealth({
      userId: "principal_123",
      now: new Date("2026-04-29T12:00:00.000Z"),
      deps: {
        ...readyDeps,
        getGoogleReadiness: async () => ({
          ready: false,
          status: "scope_missing",
          required_scopes: [],
          granted_scopes: [],
          missing_scopes: [],
          blockers: ["google_oauth_scope_missing"],
        }),
      },
    });

    const calendar = result.checks.find((check) => check.source === "calendar");
    expect(calendar).toEqual({
      source: "calendar",
      status: "reauth_required",
      reason: "google_oauth_scope_missing",
      action: "google_reconsent",
    });
    expect(JSON.stringify(calendar)).not.toMatch(/gmail/i);
  });

  it("captures thrown external calls as error checks without failing the report", async () => {
    const result = await getWorkbenchConnectorHealth({
      userId: "principal_123",
      now: new Date("2026-04-29T12:00:00.000Z"),
      deps: {
        ...readyDeps,
        retrieveNotionContext: async () => {
          throw new Error("Notion timeout");
        },
        createCalendarClient: () => ({
          status: "available",
          client: {
            searchEvents: async () => {
              throw new Error("Calendar 500");
            },
          },
        }),
        checkDriveFolder: async () => {
          throw new Error("Drive 403");
        },
      },
    });

    expect(result.checks).toEqual([
      { source: "config", status: "ready" },
      {
        source: "notion",
        status: "error",
        reason: "notion_check_failed",
        message: "Notion timeout",
      },
      { source: "google", status: "ready" },
      {
        source: "calendar",
        status: "error",
        reason: "calendar_check_failed",
        message: "Calendar 500",
      },
      {
        source: "drive",
        status: "error",
        reason: "drive_check_failed",
        message: "Drive 403",
      },
    ]);
  });
});

describe("Drive folder capability checker", () => {
  it("calls Drive files.get and treats writable folders as ready", async () => {
    const calls: Array<{ url: string; auth?: string }> = [];

    const result = await checkDriveFolderCapability({
      driveFolderId: "folder-123",
      accessToken: "google-token",
      fetch: async (url, init) => {
        calls.push({
          url: String(url),
          auth: (init?.headers as Record<string, string>).Authorization,
        });
        return new Response(
          JSON.stringify({
            id: "folder-123",
            mimeType: "application/vnd.google-apps.folder",
            capabilities: { canAddChildren: true },
          }),
          { status: 200 },
        );
      },
    });

    expect(result).toEqual({ source: "drive", status: "ready" });
    expect(calls).toEqual([
      {
        url: "https://www.googleapis.com/drive/v3/files/folder-123?fields=id%2CmimeType%2Ccapabilities%28canAddChildren%29&supportsAllDrives=true",
        auth: "Bearer google-token",
      },
    ]);
  });

  it("reports folders that cannot add children as resource missing", async () => {
    const result = await checkDriveFolderCapability({
      driveFolderId: "folder-123",
      accessToken: "google-token",
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: "folder-123",
            mimeType: "application/vnd.google-apps.folder",
            capabilities: { canAddChildren: false },
          }),
          { status: 200 },
        ),
    });

    expect(result).toEqual({
      source: "drive",
      status: "resource_missing",
      reason: "drive_folder_not_writable",
    });
  });

  it("reports inaccessible Drive folders as resource or auth states", async () => {
    await expect(
      checkDriveFolderCapability({
        driveFolderId: "folder-123",
        accessToken: "google-token",
        fetch: async () =>
          new Response(JSON.stringify({ error: { message: "not found" } }), {
            status: 404,
          }),
      }),
    ).resolves.toEqual({
      source: "drive",
      status: "resource_missing",
      reason: "drive_folder_missing",
      message: "not found",
    });

    await expect(
      checkDriveFolderCapability({
        driveFolderId: "folder-123",
        accessToken: "google-token",
        fetch: async () =>
          new Response(JSON.stringify({ error: { message: "invalid token" } }), {
            status: 401,
          }),
      }),
    ).resolves.toEqual({
      source: "drive",
      status: "reauth_required",
      reason: "google_reauth_required",
      message: "invalid token",
      action: "google_reconsent",
    });
  });
});
