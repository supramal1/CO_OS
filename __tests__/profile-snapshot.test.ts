import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProfileSnapshot } from "@/lib/profile/profile-snapshot";

describe("Profile snapshot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
        getMondayStatus: () => ({
          source: "monday",
          state: "disconnected",
          connected: false,
          configured: true,
          message: "monday is ready to connect. Identity confirmation comes next.",
          actionLabel: "Connect",
          nextUrl: "/profile",
        }),
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
    expect(snapshot.connectedTools.find((tool) => tool.id === "monday")).toMatchObject({
      status: "needs_setup",
      actionLabel: "Connect",
      connectedAs: "monday is ready to connect. Identity confirmation comes next.",
      meta: "Identity",
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

  it("keeps learned Honcho preferences readable instead of duplicating a truncated sentence", async () => {
    const learnedPreference =
      "Malik prioritizes a direct, no-BS communication style, favoring one-pagers over slide decks, and focuses on AI as a tool for upskilling staff and enhancing judgment work. His technical approach emphasizes robust infrastructure, clear operational ownership, and practical delivery over decorative product surfaces.";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ context: learnedPreference }),
      })),
    );

    const snapshot = await buildProfileSnapshot({
      apiKey: "csk_test",
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

    expect(snapshot.personalisation.cards).toHaveLength(1);
    expect(snapshot.personalisation.cards[0]).toMatchObject({
      title: "Communication and work preferences",
      detail: learnedPreference,
      source: "honcho",
    });
  });

  it("strips raw Cornerstone graph sections from Profile personalisation", async () => {
    const learnedPreference =
      "While Malik values direct, no-BS communication and prioritizes technical clarity, he also emphasizes a human-centric AI philosophy focused on staff retention and upskilling.";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            context: `${learnedPreference}\n[IDENTITY] - self_entity_id: Malik James-Williams\n[FACTS] - [general] noisy raw fact`,
          }),
      })),
    );

    const snapshot = await buildProfileSnapshot({
      apiKey: "csk_test",
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

    expect(snapshot.personalisation.cards[0]?.detail).toBe(learnedPreference);
    expect(snapshot.personalisation.cards[0]?.detail).not.toContain("[IDENTITY]");
    expect(snapshot.personalisation.cards[0]?.detail).not.toContain("[FACTS]");
  });
});
