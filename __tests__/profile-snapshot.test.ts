import { describe, expect, it } from "vitest";
import { buildProfileSnapshot } from "@/lib/profile/profile-snapshot";

describe("Profile snapshot", () => {
  it("builds identity and connected-tool state from the signed-in session", async () => {
    const snapshot = await buildProfileSnapshot({
      session: {
        principalId: "principal_123",
        isAdmin: false,
        expires: "2026-05-30T00:00:00.000Z",
        user: {
          name: "Malik James-Williams",
          email: "malik@example.com",
        },
      },
      deps: {
        listConnectorStatuses: async () => [
          {
            source: "notion",
            status: "ready",
            action: "status",
            message: "Notion workspace ready.",
          },
          {
            source: "google_workspace",
            status: "reauth_required",
            action: "repair_redirect",
            next_url: "/workbench?google_oauth=start",
            reason: "token_missing",
          },
        ],
      },
    });

    expect(snapshot.identity).toEqual({
      userId: "principal_123",
      name: "Malik James-Williams",
      email: "malik@example.com",
      role: "staff",
      teamSlugs: [],
      workspaceSlugs: [],
      cornerstonePrincipalId: "principal_123",
      activeProjectIds: [],
      activeClientIds: [],
    });
    expect(snapshot.stats.map((stat) => stat.label)).toEqual([
      "Active projects",
      "Connected tools",
    ]);
    expect(snapshot.connectedTools.find((tool) => tool.id === "notion")).toMatchObject({
      status: "connected",
      actionLabel: "View",
      connectedAs: "Notion workspace ready.",
    });
    expect(snapshot.connectedTools.find((tool) => tool.id === "google")).toMatchObject({
      status: "needs_setup",
      actionLabel: "Reconnect",
      href: "/workbench?google_oauth=start",
    });
    expect(snapshot.connectedTools.find((tool) => tool.id === "calendar")).toMatchObject({
      status: "needs_setup",
      actionLabel: "Reconnect",
      href: "/workbench?google_oauth=start",
    });
    expect(snapshot.connectedTools.find((tool) => tool.id === "drive")).toMatchObject({
      status: "needs_setup",
      actionLabel: "Reconnect",
      href: "/workbench?google_oauth=start",
    });
  });

  it("keeps a human-readable disconnected state when connector lookup fails", async () => {
    const snapshot = await buildProfileSnapshot({
      session: {
        principalId: "principal_123",
        isAdmin: true,
        expires: "2026-05-30T00:00:00.000Z",
        user: { email: "admin@example.com" },
      },
      deps: {
        listConnectorStatuses: async () => {
          throw new Error("connector service unavailable");
        },
      },
    });

    expect(snapshot.identity.role).toBe("admin");
    expect(snapshot.connectedTools.find((tool) => tool.id === "notion")).toMatchObject({
      status: "needs_setup",
      actionLabel: "Try again",
      connectedAs: "Connection state unavailable.",
    });
    expect(snapshot.connectedTools.find((tool) => tool.id === "google")).toMatchObject({
      status: "needs_setup",
      actionLabel: "Try again",
      connectedAs: "Connection state unavailable.",
    });
    expect(snapshot.connectedTools.find((tool) => tool.id === "drive")).toMatchObject({
      status: "needs_setup",
      actionLabel: "Try again",
      connectedAs: "Connection state unavailable.",
    });
  });
});
