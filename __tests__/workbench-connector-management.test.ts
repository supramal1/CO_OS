import { describe, expect, it, vi } from "vitest";
import {
  getWorkbenchConnectorManagementStatus,
  manageWorkbenchConnector,
  normalizeWorkbenchConnectorSource,
} from "@/lib/workbench/connector-management";
import type { WorkbenchConnectorHealthResponse } from "@/lib/workbench/connector-health";

const readyHealth: WorkbenchConnectorHealthResponse = {
  generated_at: "2026-04-29T12:00:00.000Z",
  checks: [
    { source: "config", status: "ready" },
    { source: "notion", status: "ready" },
    { source: "google", status: "ready" },
    { source: "calendar", status: "ready" },
    { source: "drive", status: "ready" },
  ],
};

const readyGoogleReadiness = {
  ready: true,
  status: "ready" as const,
  required_scopes: [],
  granted_scopes: [],
  missing_scopes: [],
  blockers: [],
};

describe("Workbench connector management", () => {
  it("normalizes only V1 managed connector sources and excludes Gmail", () => {
    expect(normalizeWorkbenchConnectorSource("notion")).toBe("notion");
    expect(normalizeWorkbenchConnectorSource("google-workspace")).toBe(
      "google_workspace",
    );
    expect(normalizeWorkbenchConnectorSource("google_workspace")).toBe(
      "google_workspace",
    );
    expect(normalizeWorkbenchConnectorSource("gmail")).toBeNull();
  });

  it("maps Notion and Google Workspace status checks to UI-friendly responses", async () => {
    const getHealth = vi.fn(async () => ({
      ...readyHealth,
      checks: readyHealth.checks.map((check) =>
        check.source === "drive"
          ? {
              source: "drive" as const,
              status: "repair_available" as const,
              reason: "missing_drive_folder",
              blockers: ["drive_folder_id_missing"],
            }
          : check,
      ),
    }));

    await expect(
      getWorkbenchConnectorManagementStatus({
        userId: "principal_123",
        source: "notion",
        deps: { getHealth },
      }),
    ).resolves.toEqual({
      source: "notion",
      status: "ready",
      action: "status",
    });

    await expect(
      getWorkbenchConnectorManagementStatus({
        userId: "principal_123",
        source: "google_workspace",
        deps: { getHealth },
      }),
    ).resolves.toEqual({
      source: "google_workspace",
      status: "repair_available",
      action: "status",
      reason: "missing_drive_folder",
      message: "Drive folder needs repair.",
    });
  });

  it("returns a Notion repair redirect when no stored OAuth token is available", async () => {
    const ensureNotionSetup = vi.fn();

    const result = await manageWorkbenchConnector({
      userId: "principal_123",
      source: "notion",
      action: "repair",
      deps: {
        notionTokenStore: { get: async () => null },
        ensureNotionSetup,
      },
    });

    expect(result).toEqual({
      source: "notion",
      status: "reauth_required",
      action: "repair_redirect",
      next_url: "/api/workbench/notion/start",
      message: "Connect Notion to repair Workbench pages.",
      reason: "notion_oauth_required",
    });
    expect(ensureNotionSetup).not.toHaveBeenCalled();
  });

  it("runs idempotent Notion repair with an existing stored token without returning token values", async () => {
    const ensureNotionSetup = vi.fn(async () => ({
      status: "validated" as const,
      parent_id: "notion-parent",
      child_ids: {
        "Personal Profile": "child-personal",
        "Working On": "child-working",
        Patterns: "child-patterns",
        References: "child-references",
        Voice: "child-voice",
      },
      counts: { created: 0, validated: 6, repaired: 0 },
    }));
    const getConfig = vi.fn(async () => ({
      user_id: "principal_123",
      notion_parent_page_id: "notion-parent",
      drive_folder_id: "drive-folder",
      drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
      google_oauth_grant_status: "granted",
      google_oauth_scopes: [],
      voice_register: null,
      feedback_style: null,
      friction_tasks: null,
    }));

    const result = await manageWorkbenchConnector({
      userId: "principal_123",
      source: "notion",
      action: "repair",
      deps: {
        getConfig,
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
      reason: "validated",
    });
    expect(ensureNotionSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "principal_123",
        token: "secret-notion-token",
      }),
    );
    expect(JSON.stringify(result)).not.toContain("secret-notion-token");
  });

  it("returns a Google Workspace repair redirect when OAuth readiness is not ready", async () => {
    const ensureDriveSetup = vi.fn();

    const result = await manageWorkbenchConnector({
      userId: "principal_123",
      source: "google_workspace",
      action: "repair",
      deps: {
        getGoogleReadiness: async () => ({
          ready: false,
          status: "grant_missing",
          required_scopes: [],
          granted_scopes: [],
          missing_scopes: [],
          blockers: ["google_oauth_grant_missing"],
        }),
        ensureDriveSetup,
      },
    });

    expect(result).toEqual({
      source: "google_workspace",
      status: "reauth_required",
      action: "repair_redirect",
      next_url: "/workbench?google_oauth=start",
      message: "Reconnect Google Workspace to repair Drive and Calendar.",
      reason: "grant_missing",
    });
    expect(ensureDriveSetup).not.toHaveBeenCalled();
  });

  it("runs idempotent Google Workspace repair without returning token values", async () => {
    const config = {
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
    const ensureDriveSetup = vi.fn(async () => ({
      status: "ready" as const,
      reason: "existing_valid" as const,
      repaired: false,
      drive_folder_id: "drive-folder",
      drive_folder_url: "https://drive.google.com/drive/folders/drive-folder",
      updated: false,
    }));

    const result = await manageWorkbenchConnector({
      userId: "principal_123",
      source: "google_workspace",
      action: "repair",
      deps: {
        getConfig: async () => config,
        getGoogleReadiness: async () => ({
          ready: true,
          status: "ready",
          required_scopes: [],
          granted_scopes: [],
          missing_scopes: [],
          blockers: [],
        }),
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
      reason: "existing_valid",
    });
    expect(ensureDriveSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "principal_123",
        accessToken: "secret-google-token",
        config,
      }),
    );
    expect(JSON.stringify(result)).not.toContain("secret-google-token");
  });

  it("disconnects Notion by clearing only local config readiness", async () => {
    const patchConfig = vi.fn(async () => ({
      status: "ok" as const,
      config: null,
      google_readiness: readyGoogleReadiness,
    }));

    const result = await manageWorkbenchConnector({
      userId: "principal_123",
      source: "notion",
      action: "disconnect",
      deps: { patchConfig },
    });

    expect(result).toEqual({
      source: "notion",
      status: "accepted",
      action: "disconnect",
      message: "Notion config disconnected.",
      reason: "token_revocation_not_supported_v1",
    });
    expect(patchConfig).toHaveBeenCalledWith("principal_123", {
      notion_parent_page_id: null,
    });
  });

  it("disconnects Google Workspace by clearing local grant and Drive readiness only", async () => {
    const patchConfig = vi.fn(async () => ({
      status: "ok" as const,
      config: null,
      google_readiness: readyGoogleReadiness,
    }));

    const result = await manageWorkbenchConnector({
      userId: "principal_123",
      source: "google_workspace",
      action: "disconnect",
      deps: { patchConfig },
    });

    expect(result).toEqual({
      source: "google_workspace",
      status: "accepted",
      action: "disconnect",
      message: "Google Workspace config disconnected.",
      reason: "token_revocation_not_supported_v1",
    });
    expect(patchConfig).toHaveBeenCalledWith("principal_123", {
      drive_folder_id: null,
      drive_folder_url: null,
      google_oauth_grant_status: "revoked",
      google_oauth_scopes: [],
    });
  });
});
