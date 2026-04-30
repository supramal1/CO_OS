import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listWorkbenchConnectorManagementStatuses: vi.fn(),
  getWorkbenchConnectorManagementStatus: vi.fn(),
  manageWorkbenchConnector: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/workbench/connector-management", () => {
  const sources = new Map([
    ["notion", "notion"],
    ["google_workspace", "google_workspace"],
    ["google-workspace", "google_workspace"],
  ]);
  const actions = new Set(["status", "repair", "disconnect"]);

  return {
    WORKBENCH_MANAGED_CONNECTOR_SOURCES: ["notion", "google_workspace"],
    WORKBENCH_CONNECTOR_MANAGEMENT_ACTIONS: [
      "status",
      "repair",
      "disconnect",
    ],
    normalizeWorkbenchConnectorSource: (source: string) =>
      sources.get(source) ?? null,
    isWorkbenchConnectorManagementAction: (action: unknown) =>
      typeof action === "string" && actions.has(action),
    listWorkbenchConnectorManagementStatuses: (...args: unknown[]) =>
      mocks.listWorkbenchConnectorManagementStatuses(...args),
    getWorkbenchConnectorManagementStatus: (...args: unknown[]) =>
      mocks.getWorkbenchConnectorManagementStatus(...args),
    manageWorkbenchConnector: (...args: unknown[]) =>
      mocks.manageWorkbenchConnector(...args),
  };
});

import {
  GET as GET_SOURCE,
  POST as POST_SOURCE,
} from "@/app/api/workbench/connectors/[source]/route";
import { GET as LIST_CONNECTORS } from "@/app/api/workbench/connectors/route";

function request(body: unknown = {}, url = "http://localhost/api/workbench/connectors/notion"): NextRequest {
  return {
    url,
    json: async () => body,
  } as unknown as NextRequest;
}

function context(source: string) {
  return { params: Promise.resolve({ source }) };
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.listWorkbenchConnectorManagementStatuses.mockReset();
  mocks.getWorkbenchConnectorManagementStatus.mockReset();
  mocks.manageWorkbenchConnector.mockReset();
});

describe("/api/workbench/connectors", () => {
  it("rejects unauthenticated connector status requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await LIST_CONNECTORS();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.listWorkbenchConnectorManagementStatuses).not.toHaveBeenCalled();
  });

  it("returns managed connector statuses for the authenticated principal", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.listWorkbenchConnectorManagementStatuses.mockResolvedValue([
      { source: "notion", status: "ready", action: "status" },
      {
        source: "google_workspace",
        status: "reauth_required",
        action: "status",
        reason: "grant_missing",
        next_url: "/workbench?google_oauth=start",
      },
    ]);

    const res = await LIST_CONNECTORS();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connectors: [
        { source: "notion", status: "ready", action: "status" },
        {
          source: "google_workspace",
          status: "reauth_required",
          action: "status",
          reason: "grant_missing",
          next_url: "/workbench?google_oauth=start",
        },
      ],
    });
    expect(mocks.listWorkbenchConnectorManagementStatuses).toHaveBeenCalledWith({
      userId: "principal_123",
    });
  });
});

describe("/api/workbench/connectors/[source]", () => {
  it("rejects unauthenticated source status requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET_SOURCE(request(), context("notion"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.getWorkbenchConnectorManagementStatus).not.toHaveBeenCalled();
  });

  it("rejects invalid connector sources", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });

    const res = await GET_SOURCE(request(), context("gmail"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_connector_source",
      allowed: ["notion", "google_workspace"],
    });
    expect(mocks.getWorkbenchConnectorManagementStatus).not.toHaveBeenCalled();
  });

  it("rejects invalid connector actions", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });

    const res = await POST_SOURCE(request({ action: "refresh" }), context("notion"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_connector_action",
      allowed: ["status", "repair", "disconnect"],
    });
    expect(mocks.manageWorkbenchConnector).not.toHaveBeenCalled();
  });

  it("returns a Notion repair redirect when OAuth is required", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.manageWorkbenchConnector.mockResolvedValue({
      source: "notion",
      status: "reauth_required",
      action: "repair_redirect",
      next_url: "/api/workbench/notion/start",
      message: "Connect Notion to repair Workbench pages.",
      reason: "notion_oauth_required",
    });

    const res = await POST_SOURCE(request({ action: "repair" }), context("notion"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source: "notion",
      status: "reauth_required",
      action: "repair_redirect",
      next_url: "/api/workbench/notion/start",
      message: "Connect Notion to repair Workbench pages.",
      reason: "notion_oauth_required",
    });
    expect(mocks.manageWorkbenchConnector).toHaveBeenCalledWith({
      userId: "principal_123",
      source: "notion",
      action: "repair",
      requestUrl: "http://localhost/api/workbench/connectors/notion",
    });
  });

  it("returns Notion ready after idempotent repair", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.manageWorkbenchConnector.mockResolvedValue({
      source: "notion",
      status: "ready",
      action: "repair",
      message: "Notion workspace ready.",
      reason: "validated",
    });

    const res = await POST_SOURCE(request({ action: "repair" }), context("notion"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source: "notion",
      status: "ready",
      action: "repair",
      message: "Notion workspace ready.",
      reason: "validated",
    });
  });

  it("returns a Google Workspace repair redirect when OAuth is required", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.manageWorkbenchConnector.mockResolvedValue({
      source: "google_workspace",
      status: "reauth_required",
      action: "repair_redirect",
      next_url: "/workbench?google_oauth=start",
      message: "Reconnect Google Workspace to repair Drive and Calendar.",
      reason: "grant_missing",
    });

    const res = await POST_SOURCE(
      request(
        { action: "repair" },
        "http://localhost/api/workbench/connectors/google-workspace",
      ),
      context("google-workspace"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source: "google_workspace",
      status: "reauth_required",
      action: "repair_redirect",
      next_url: "/workbench?google_oauth=start",
      message: "Reconnect Google Workspace to repair Drive and Calendar.",
      reason: "grant_missing",
    });
    expect(mocks.manageWorkbenchConnector).toHaveBeenCalledWith({
      userId: "principal_123",
      source: "google_workspace",
      action: "repair",
      requestUrl: "http://localhost/api/workbench/connectors/google-workspace",
    });
  });

  it("returns Google Workspace ready after idempotent repair", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.manageWorkbenchConnector.mockResolvedValue({
      source: "google_workspace",
      status: "ready",
      action: "repair",
      message: "Google Workspace ready.",
      reason: "existing_valid",
    });

    const res = await POST_SOURCE(
      request({ action: "repair" }),
      context("google_workspace"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source: "google_workspace",
      status: "ready",
      action: "repair",
      message: "Google Workspace ready.",
      reason: "existing_valid",
    });
  });

  it("returns accepted disconnect responses without exposing token values", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.manageWorkbenchConnector.mockResolvedValue({
      source: "google_workspace",
      status: "accepted",
      action: "disconnect",
      message: "Google Workspace config disconnected.",
      reason: "token_revocation_not_supported_v1",
    });

    const res = await POST_SOURCE(
      request({ action: "disconnect" }),
      context("google_workspace"),
    );

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({
      source: "google_workspace",
      status: "accepted",
      action: "disconnect",
      message: "Google Workspace config disconnected.",
      reason: "token_revocation_not_supported_v1",
    });
    expect(JSON.stringify(body)).not.toMatch(/token-[a-z0-9]/i);
  });
});
