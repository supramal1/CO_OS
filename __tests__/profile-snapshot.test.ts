import { describe, expect, it } from "vitest";
import { buildProfileSnapshot } from "@/lib/profile/profile-snapshot";

describe("Profile snapshot", () => {
  it("builds identity and connected-tool state from the signed-in session", async () => {
    const snapshot = await buildProfileSnapshot({
      apiKey: "csk_test",
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
        loadPersonalisationCards: async () => ({
          cards: [
            {
              id: "honcho-brief-style",
              title: "Prefers source-backed briefs",
              detail:
                "Recent saved conversations suggest concise summaries with provenance are useful.",
              source: "honcho",
              confidence: "medium",
              actions: ["keep", "correct", "remove"],
            },
            {
              id: "notion-voice",
              title: "Use direct voice",
              detail: "Notion Voice & Style says to keep recommendations direct.",
              source: "notion",
              confidence: "high",
              actions: ["keep", "correct", "remove"],
            },
          ],
          sources: [
            { source: "honcho", status: "ok", label: "Honcho" },
            { source: "notion", status: "ok", label: "Notion" },
          ],
        }),
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
    expect(snapshot.personalisation.cards.map((card) => card.source)).toEqual([
      "honcho",
      "notion",
    ]);
    expect(snapshot.personalisation.cards[0]).toMatchObject({
      title: "Prefers source-backed briefs",
      actions: ["keep", "correct", "remove"],
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

  it("returns a clear Honcho unavailable state when no Cornerstone API key is available", async () => {
    const snapshot = await buildProfileSnapshot({
      session: {
        principalId: "principal_123",
        isAdmin: false,
        expires: "2026-05-30T00:00:00.000Z",
        user: { email: "staff@example.com" },
      },
      deps: {
        listConnectorStatuses: async () => [],
      },
    });

    expect(snapshot.personalisation.cards).toEqual([]);
    expect(snapshot.personalisation.sources.find((source) => source.source === "honcho")).toEqual({
      source: "honcho",
      status: "unavailable",
      label: "Honcho",
      detail: "Cornerstone API key unavailable.",
    });
  });
});
