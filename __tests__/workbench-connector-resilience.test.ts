import { describe, expect, it, vi } from "vitest";
import {
  getWorkbenchConnectorManagementStatus,
  manageWorkbenchConnector,
} from "@/lib/workbench/connector-management";
import { gatherWorkbenchRetrieval } from "@/lib/workbench/retrieval";
import type { WorkbenchConnectorHealthResponse } from "@/lib/workbench/connector-health";
import type {
  WorkbenchDriveSetupResult,
  WorkbenchDriveSetupUpdate,
} from "@/lib/workbench/google-drive-setup";
import type {
  WorkbenchNotionSetupInput,
  WorkbenchNotionSetupReport,
} from "@/lib/workbench/notion-setup";
import { WORKBENCH_NOTION_SETUP_CHILD_TITLES } from "@/lib/workbench/notion-setup";
import type { WorkbenchUserConfig } from "@/lib/workbench/retrieval/types";

const principalId = "principal_123";
const googleRepairUrl = "/workbench?google_oauth=start";

const readyGoogleReadiness = {
  ready: true,
  status: "ready" as const,
  required_scopes: [],
  granted_scopes: [],
  missing_scopes: [],
  blockers: [],
};

describe("Workbench connector resilience", () => {
  it("keeps missing Notion parent pages repairable without exposing tokens", async () => {
    const getHealth = vi.fn(
      async (): Promise<WorkbenchConnectorHealthResponse> => ({
        generated_at: "2026-04-29T12:00:00.000Z",
        checks: [
          {
            source: "notion",
            status: "resource_missing",
            reason: "notion_parent_page_missing",
            message: "Notion API request failed with status 404",
          },
        ],
      }),
    );
    await expect(
      getWorkbenchConnectorManagementStatus({
        userId: principalId,
        source: "notion",
        deps: { getHealth },
      }),
    ).resolves.toEqual({
      source: "notion",
      status: "resource_missing",
      action: "status",
      reason: "notion_parent_page_missing",
      message: "Notion API request failed with status 404",
    });

    const patchConfig = vi.fn(async () => ({
      status: "ok" as const,
      config: null,
      google_readiness: readyGoogleReadiness,
    }));
    const ensureNotionSetup = vi.fn(
      async (
        input: WorkbenchNotionSetupInput,
      ): Promise<WorkbenchNotionSetupReport> => {
        await input.updateConfig?.({
          userId: input.userId,
          notion_parent_page_id: "notion-parent-recreated",
        });

        return {
          status: "created",
          parent_id: "notion-parent-recreated",
          child_ids: notionChildIds("notion-child"),
          counts: { created: 6, validated: 0, repaired: 0 },
        };
      },
    );

    const result = await manageWorkbenchConnector({
      userId: principalId,
      source: "notion",
      action: "repair",
      deps: {
        getConfig: async () => ({
          ...workbenchConfig(),
          notion_parent_page_id: "notion-parent-deleted",
        }),
        patchConfig,
        notionTokenStore: {
          get: async () => ({
            accessToken: "secret-notion-token",
            refreshToken: null,
            botId: null,
            workspaceId: null,
            workspaceName: null,
            duplicatedTemplateId: null,
          }),
        },
        ensureNotionSetup,
      },
    });

    expect(result).toEqual({
      source: "notion",
      status: "ready",
      action: "repair",
      message: "Notion workspace ready.",
      reason: "created",
    });
    expect(patchConfig).toHaveBeenCalledWith(principalId, {
      notion_parent_page_id: "notion-parent-recreated",
    });
    expect(JSON.stringify(result)).not.toContain("secret-notion-token");
  });

  it("repairs a deleted Drive folder by persisting a replacement folder", async () => {
    const patchConfig = vi.fn(async () => ({
      status: "ok" as const,
      config: null,
      google_readiness: readyGoogleReadiness,
    }));
    const ensureDriveSetup = vi.fn(
      async (input: {
        userId: string;
        updateConfig?: (update: WorkbenchDriveSetupUpdate) => Promise<void>;
      }): Promise<WorkbenchDriveSetupResult> => {
        await input.updateConfig?.({
          userId: input.userId,
          drive_folder_id: "drive-folder-replacement",
          drive_folder_url:
            "https://drive.google.com/drive/folders/drive-folder-replacement",
        });

        return {
          status: "ready",
          reason: "resource_missing",
          repaired: true,
          drive_folder_id: "drive-folder-replacement",
          drive_folder_url:
            "https://drive.google.com/drive/folders/drive-folder-replacement",
          updated: true,
        };
      },
    );

    const result = await manageWorkbenchConnector({
      userId: principalId,
      source: "google_workspace",
      action: "repair",
      deps: {
        getConfig: async () => ({
          ...workbenchConfig(),
          drive_folder_id: "drive-folder-deleted",
          drive_folder_url:
            "https://drive.google.com/drive/folders/drive-folder-deleted",
        }),
        patchConfig,
        getGoogleReadiness: async () => readyGoogleReadiness,
        googleAccessTokenProvider: async () => ({
          status: "available",
          accessToken: "secret-google-token",
        }),
        ensureDriveSetup,
      },
    });

    expect(result).toEqual({
      source: "google_workspace",
      status: "ready",
      action: "repair",
      message: "Google Workspace ready.",
      reason: "resource_missing",
    });
    expect(patchConfig).toHaveBeenCalledWith(principalId, {
      drive_folder_id: "drive-folder-replacement",
      drive_folder_url:
        "https://drive.google.com/drive/folders/drive-folder-replacement",
    });
    expect(JSON.stringify(result)).not.toContain("secret-google-token");
  });

  it("redirects Google Workspace repair when an expired token refresh was revoked", async () => {
    const ensureDriveSetup = vi.fn();

    const result = await manageWorkbenchConnector({
      userId: principalId,
      source: "google_workspace",
      action: "repair",
      deps: {
        getGoogleReadiness: async () => readyGoogleReadiness,
        googleAccessTokenProvider: async () => {
          throw new Error("google_token_refresh_failed: invalid_grant");
        },
        ensureDriveSetup,
      },
    });

    expect(result).toEqual({
      source: "google_workspace",
      status: "reauth_required",
      action: "repair_redirect",
      next_url: googleRepairUrl,
      message: "Reconnect Google Workspace to repair Drive and Calendar.",
      reason: "google_token_refresh_failed",
    });
    expect(ensureDriveSetup).not.toHaveBeenCalled();
  });

  it("keeps Calendar retrieval unavailable when an expired token refresh was revoked", async () => {
    const calendarFetch = vi.fn();

    const result = await gatherWorkbenchRetrieval({
      ask: "Prep Acme renewal deck",
      userId: principalId,
      apiKey: "csk_test",
      config: workbenchConfig(),
      now: new Date("2026-04-29T12:00:00.000Z"),
      googleAccessTokenProvider: async () => {
        throw new Error("google_token_refresh_failed: invalid_grant");
      },
      calendarFetch,
      adapters: availableNonGoogleAdapters(),
    });

    expect(result.sources.find((source) => source.source === "calendar"))
      .toMatchObject({
        source: "calendar",
        status: "unavailable",
        items: [],
        warnings: ["google_token_refresh_failed"],
      });
    expect(calendarFetch).not.toHaveBeenCalled();
  });

  it("does not request Calendar tokens when the Calendar scope is missing", async () => {
    const tokenProvider = vi.fn(async () => ({
      status: "available" as const,
      accessToken: "stale-google-token",
    }));

    const result = await gatherWorkbenchRetrieval({
      ask: "Prep Acme renewal deck",
      userId: principalId,
      apiKey: "csk_test",
      config: {
        ...workbenchConfig(),
        google_oauth_scopes: [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/spreadsheets",
        ],
      },
      now: new Date("2026-04-29T12:00:00.000Z"),
      googleAccessTokenProvider: tokenProvider,
      adapters: availableNonGoogleAdapters(),
    });

    expect(tokenProvider).not.toHaveBeenCalled();
    expect(result.sources.find((source) => source.source === "calendar"))
      .toMatchObject({
        source: "calendar",
        status: "unavailable",
        items: [],
        warnings: ["google_calendar_scope_missing"],
      });
  });

  it("does not request Calendar tokens after the Google grant is revoked", async () => {
    const tokenProvider = vi.fn(async () => ({
      status: "available" as const,
      accessToken: "stale-google-token",
    }));

    const result = await gatherWorkbenchRetrieval({
      ask: "Prep Acme renewal deck",
      userId: principalId,
      apiKey: "csk_test",
      config: {
        ...workbenchConfig(),
        google_oauth_grant_status: "revoked",
        google_oauth_scopes: [],
      },
      now: new Date("2026-04-29T12:00:00.000Z"),
      googleAccessTokenProvider: tokenProvider,
      adapters: availableNonGoogleAdapters(),
    });

    expect(tokenProvider).not.toHaveBeenCalled();
    expect(result.sources.find((source) => source.source === "calendar"))
      .toMatchObject({
        source: "calendar",
        status: "unavailable",
        items: [],
        warnings: ["google_oauth_grant_not_active"],
      });
  });
});

function workbenchConfig(): WorkbenchUserConfig {
  return {
    user_id: principalId,
    notion_parent_page_id: "notion-parent",
    drive_folder_id: "drive-folder",
    drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
    google_oauth_grant_status: "granted",
    google_oauth_scopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
    voice_register: null,
    feedback_style: null,
    friction_tasks: null,
  };
}

function notionChildIds(prefix: string): Record<string, string> {
  return Object.fromEntries(
    WORKBENCH_NOTION_SETUP_CHILD_TITLES.map((title, index) => [
      title,
      `${prefix}-${index + 1}`,
    ]),
  );
}

function availableNonGoogleAdapters() {
  return {
    cornerstone: async () => ({
      items: [],
      status: {
        source: "cornerstone" as const,
        status: "ok" as const,
        items_count: 0,
      },
    }),
    notion: async () => ({
      items: [],
      status: {
        source: "notion" as const,
        status: "ok" as const,
        items_count: 0,
      },
    }),
  };
}
