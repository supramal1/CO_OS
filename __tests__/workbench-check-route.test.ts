import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getWorkbenchConnectorHealth: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/workbench/connector-health", () => ({
  getWorkbenchConnectorHealth: (...args: unknown[]) =>
    mocks.getWorkbenchConnectorHealth(...args),
}));

import { GET } from "@/app/api/workbench/check/route";

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getWorkbenchConnectorHealth.mockReset();
});

describe("GET /api/workbench/check", () => {
  it("rejects unauthenticated staff", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns connector checks for the authenticated principal", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.getWorkbenchConnectorHealth.mockResolvedValue({
      generated_at: "2026-04-29T12:00:00.000Z",
      checks: [
        { source: "config", status: "ready" },
        {
          source: "notion",
          status: "repair_available",
          reason: "notion_child_pages_missing",
        },
        { source: "google", status: "ready" },
        {
          source: "calendar",
          status: "reauth_required",
          reason: "google_oauth_scope_missing",
          action: "google_reconsent",
        },
        {
          source: "drive",
          status: "resource_missing",
          reason: "drive_folder_not_writable",
        },
      ],
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      generated_at: "2026-04-29T12:00:00.000Z",
      checks: [
        { source: "config", status: "ready" },
        {
          source: "notion",
          status: "repair_available",
          reason: "notion_child_pages_missing",
        },
        { source: "google", status: "ready" },
        {
          source: "calendar",
          status: "reauth_required",
          reason: "google_oauth_scope_missing",
          action: "google_reconsent",
        },
        {
          source: "drive",
          status: "resource_missing",
          reason: "drive_folder_not_writable",
        },
      ],
    });
    expect(mocks.getWorkbenchConnectorHealth).toHaveBeenCalledWith({
      userId: "principal_123",
    });
  });
});
