import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFastProfileSnapshot,
  buildProfileSnapshot,
} from "@/lib/profile/profile-snapshot";
import { cleanPersonalisationContextText } from "@/lib/profile/personalisation-context";
import { clearProfileStateCache } from "@/lib/profile/profile-cache";

describe("Profile snapshot", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearProfileStateCache();
  });

  it("builds a fast shell snapshot without connector or Honcho lookups", () => {
    const snapshot = buildFastProfileSnapshot({
      principalId: "principal_123",
      isAdmin: false,
      expires: "2026-05-30T00:00:00.000Z",
      user: {
        name: "Malik James-Williams",
        email: "malik@example.com",
      },
    });

    expect(snapshot.identity).toMatchObject({
      userId: "principal_123",
      name: "Malik James-Williams",
      email: "malik@example.com",
    });
    expect(snapshot.connectedTools).toBeTruthy();
    expect(snapshot.personalisation.sources[0]).toMatchObject({
      source: "honcho",
      detail: "Profile personalisation is loading.",
    });
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

  it("keeps monday partial results when Workbench connector lookup fails", async () => {
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
        getMondayStatus: () => ({
          source: "monday",
          state: "connected",
          connected: true,
          configured: true,
          message: "monday connected as Malik.",
          actionLabel: "View",
          nextUrl: "/api/monday/status",
        }),
      },
    });

    expect(snapshot.connectedTools.find((tool) => tool.id === "notion")).toMatchObject({
      status: "needs_setup",
      actionLabel: "Try again",
      connectedAs: "Connection state unavailable.",
    });
    expect(snapshot.connectedTools.find((tool) => tool.id === "monday")).toMatchObject({
      status: "connected",
      actionLabel: "View",
      connectedAs: "monday connected as Malik.",
    });
  });

  it("times out Workbench connector loading without blocking other Profile state", async () => {
    vi.useFakeTimers();

    const snapshotPromise = buildProfileSnapshot({
      session: {
        principalId: "principal_123",
        isAdmin: false,
        expires: "2026-05-30T00:00:00.000Z",
        user: { email: "staff@example.com" },
      },
      deps: {
        connectorStatusTimeoutMs: 25,
        listConnectorStatuses: async () => new Promise(() => undefined),
        getMondayStatus: () => ({
          source: "monday",
          state: "connected",
          connected: true,
          configured: true,
          message: "monday connected as Malik.",
          actionLabel: "View",
          nextUrl: "/api/monday/status",
        }),
        loadPersonalisationCards: async () => ({
          cards: [],
          sources: [{ source: "honcho", status: "empty", label: "Honcho" }],
        }),
      },
    });

    await vi.advanceTimersByTimeAsync(25);
    const snapshot = await snapshotPromise;

    expect(snapshot.connectedTools.find((tool) => tool.id === "google")).toMatchObject({
      status: "needs_setup",
      actionLabel: "Try again",
      connectedAs: "Connection state unavailable.",
    });
    expect(snapshot.connectedTools.find((tool) => tool.id === "monday")).toMatchObject({
      status: "connected",
      connectedAs: "monday connected as Malik.",
    });
    expect(snapshot.personalisation.sources[0]).toMatchObject({
      source: "honcho",
      status: "empty",
    });
  });

  it("returns cached connector state when the live connector lookup is slow", async () => {
    let now = "2026-05-01T09:00:00.000Z";
    const clock = () => new Date(now);
    const session = {
      principalId: "principal_cache_connectors",
      isAdmin: false,
      expires: "2026-05-30T00:00:00.000Z",
      user: { email: "staff@example.com" },
    };

    await buildProfileSnapshot({
      apiKey: "csk_test",
      session,
      deps: {
        clock,
        listConnectorStatuses: async () => [
          {
            source: "notion",
            status: "ready",
            action: "status",
            message: "Notion workspace ready.",
          },
        ],
        getMondayStatus: () => ({
          source: "monday",
          state: "disconnected",
          connected: false,
          configured: true,
          message: "monday ready.",
          actionLabel: "Connect",
          nextUrl: "/profile",
        }),
        loadPersonalisationCards: async () => ({
          cards: [],
          sources: [{ source: "honcho", status: "empty", label: "Honcho" }],
        }),
      },
    });

    now = "2026-05-01T09:05:00.000Z";
    const cached = await buildProfileSnapshot({
      apiKey: "csk_test",
      session,
      deps: {
        clock,
        connectorStatusTimeoutMs: 1,
        listConnectorStatuses: async () => new Promise(() => undefined),
        getMondayStatus: () => ({
          source: "monday",
          state: "disconnected",
          connected: false,
          configured: true,
          message: "monday ready.",
          actionLabel: "Connect",
          nextUrl: "/profile",
        }),
        loadPersonalisationCards: async () => ({
          cards: [],
          sources: [{ source: "honcho", status: "empty", label: "Honcho" }],
        }),
      },
    });

    expect(cached.connectedTools.find((tool) => tool.id === "notion")).toMatchObject({
      status: "connected",
      connectedAs: "Notion workspace ready.",
      lastCheckedAt: "2026-05-01T09:05:00.000Z",
    });
    expect(cached.metadata?.connectors).toEqual({
      generatedAt: "2026-05-01T09:00:00.000Z",
      lastChecked: "2026-05-01T09:05:00.000Z",
      status: "cached",
    });
  });

  it("returns cached personalisation when live personalisation is unavailable", async () => {
    let now = "2026-05-01T10:00:00.000Z";
    const clock = () => new Date(now);
    const session = {
      principalId: "principal_cache_personalisation",
      isAdmin: false,
      expires: "2026-05-30T00:00:00.000Z",
      user: { email: "staff@example.com" },
    };

    await buildProfileSnapshot({
      apiKey: "csk_test",
      session,
      deps: {
        clock,
        listConnectorStatuses: async () => [],
        loadPersonalisationCards: async () => ({
          cards: [
            {
              id: "honcho-context-0",
              title: "Communication and work preferences",
              detail: "Keep summaries concise and source-backed.",
              source: "honcho",
              confidence: "medium",
              actions: ["keep", "correct", "remove"],
            },
          ],
          sources: [{ source: "honcho", status: "ok", label: "Honcho" }],
        }),
      },
    });

    now = "2026-05-01T10:03:00.000Z";
    const cached = await buildProfileSnapshot({
      apiKey: null,
      session,
      deps: {
        clock,
        listConnectorStatuses: async () => [],
        loadPersonalisationCards: async () => ({
          cards: [],
          sources: [
            {
              source: "honcho",
              status: "unavailable",
              label: "Honcho",
              detail: "Cornerstone API key unavailable.",
            },
          ],
        }),
      },
    });

    expect(cached.personalisation.cards[0]).toMatchObject({
      title: "Communication and work preferences",
      detail: "Keep summaries concise and source-backed.",
      lastCheckedAt: "2026-05-01T10:03:00.000Z",
    });
    expect(cached.metadata?.personalisation).toEqual({
      generatedAt: "2026-05-01T10:00:00.000Z",
      lastChecked: "2026-05-01T10:03:00.000Z",
      status: "cached",
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
    expect(snapshot.personalisation.sources.find((source) => source.source === "honcho")).toMatchObject({
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

    expect(snapshot.personalisation.cards[0]?.detail).toContain(learnedPreference);
    expect(snapshot.personalisation.cards[0]?.detail).not.toContain("[IDENTITY]");
    expect(snapshot.personalisation.cards[0]?.detail).not.toContain("[FACTS]");
  });

  it("keeps useful context around raw graph memory blocks", () => {
    const cleaned = cleanPersonalisationContextText(
      [
        "Malik prefers direct summaries with clear source provenance.",
        "=== GRAPH MEMORY ===",
        "[IDENTITY]",
        "- self_entity_id: Malik James-Williams",
        "- user_name: Malik James-Williams",
        "=== CONTEXT ===",
        "Avoid decorative product surfaces when a dense operational view is clearer.",
      ].join("\n"),
    );

    expect(cleaned).toBe(
      "Malik prefers direct summaries with clear source provenance. Avoid decorative product surfaces when a dense operational view is clearer.",
    );
    expect(cleaned).not.toMatch(/GRAPH MEMORY|IDENTITY|self_entity|user_name/i);
  });

  it("summarizes raw fact dumps without leaking fact keys or metadata", () => {
    const cleaned = cleanPersonalisationContextText(
      [
        "[FACTS]",
        "- [general] co_profile_raw_dump_20260430: Malik values terse, source-backed briefs and wants uncertainty called out plainly. (updated: 2026-04-30)",
        "- [general] raw_fact_key_without_human_content: abc_123",
        "- [general] co_profile_assumption_rule: Avoid assuming tool access or production state without checking the current source. (updated: 2026-04-30)",
      ].join("\n"),
    );

    expect(cleaned).toBe(
      "Malik values terse, source-backed briefs and wants uncertainty called out plainly. Avoid assuming tool access or production state without checking the current source.",
    );
    expect(cleaned).not.toMatch(/\[FACTS\]|co_profile|updated:|raw_fact_key/i);
  });

  it("returns a fallback when the Honcho personalisation source is slow", async () => {
    const snapshot = await buildProfileSnapshot({
      session: {
        principalId: "principal_slow_personalisation",
        isAdmin: false,
        expires: "2026-05-30T00:00:00.000Z",
        user: { email: "slow@example.com" },
      },
      deps: {
        personalisationTimeoutMs: 1,
        listConnectorStatuses: async () => [],
        loadPersonalisationCards: () => new Promise(() => {}),
      },
    });

    expect(snapshot.personalisation.cards).toEqual([]);
    expect(snapshot.personalisation.sources[0]).toMatchObject({
      source: "honcho",
      status: "empty",
      detail: "Loading latest personalisation state.",
    });
  });
});
