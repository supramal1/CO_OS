import { describe, expect, it } from "vitest";
import { gatherWorkbenchRetrieval } from "@/lib/workbench/retrieval";
import type { WorkbenchGoogleTokenStore } from "@/lib/workbench/google-token";

describe("Workbench retrieval orchestrator", () => {
  it("combines source-shaped results and preserves partial failures", async () => {
    const result = await gatherWorkbenchRetrieval({
      ask: "Prep Nike QBR response",
      userId: "principal_1",
      apiKey: "csk_test",
      config: null,
      now: new Date("2026-04-29T12:00:00.000Z"),
      adapters: {
        cornerstone: async () => ({
          source: "cornerstone",
          status: "unavailable",
          items: [],
          warnings: ["Cornerstone is offline."],
        }),
        notion: async () => ({
          source: "notion",
          status: "unavailable",
          items: [],
          warnings: ["Missing user_workbench_config.notion_parent_page_id."],
        }),
        calendar: async () => ({
          source: "calendar",
          status: "available",
          items: [
            {
              claim: "Calendar event: Nike QBR prep, 2026-05-02T10:00:00.000Z",
              source_type: "calendar",
              source_label: "Nike QBR prep",
              source_url: "https://calendar.google.com/event?eid=event-1",
            },
          ],
          warnings: [],
        }),
      },
    });

    expect(result.context).toHaveLength(1);
    expect(result.context[0]?.source_type).toBe("calendar");
    expect(result.sources.map((source) => source.status)).toEqual([
      "unavailable",
      "unavailable",
      "available",
    ]);
    expect(result.warnings).toEqual([
      "Cornerstone is offline.",
      "Missing user_workbench_config.notion_parent_page_id.",
    ]);
  });

  it("converts adapter exceptions into error source results", async () => {
    const result = await gatherWorkbenchRetrieval({
      ask: "Prep Nike QBR response",
      userId: "principal_1",
      apiKey: "csk_test",
      config: null,
      now: new Date("2026-04-29T12:00:00.000Z"),
      adapters: {
        cornerstone: async () => {
          throw new Error("Cornerstone timeout");
        },
        notion: async () => ({
          source: "notion",
          status: "unavailable",
          items: [],
          warnings: ["Missing Notion config."],
        }),
        calendar: async () => ({
          source: "calendar",
          status: "available",
          items: [],
          warnings: [],
        }),
      },
    });

    expect(result.sources[0]).toMatchObject({
      source: "cornerstone",
      status: "error",
      items: [],
      warnings: ["cornerstone retrieval failed: Cornerstone timeout"],
    });
  });

  it("uses an injected Google access token provider for live Calendar retrieval", async () => {
    const requests: string[] = [];
    const authHeaders: Array<string | null> = [];

    const result = await gatherWorkbenchRetrieval({
      ask: "Prep Nike QBR response",
      userId: "principal_live",
      apiKey: "csk_test",
      config: googleGrantedConfig(),
      now: new Date("2026-04-29T12:00:00.000Z"),
      googleAccessTokenProvider: async ({ userId }) => {
        expect(userId).toBe("principal_live");
        return { status: "available", accessToken: "calendar-token" };
      },
      calendarFetch: async (url, init) => {
        requests.push(String(url));
        const headers = new Headers(init?.headers);
        authHeaders.push(headers.get("Authorization"));

        return new Response(
          JSON.stringify({
            items: String(url).includes("q=Nike")
              ? [
                  {
                    id: "event-1",
                    summary: "Nike QBR prep",
                    htmlLink: "https://calendar.google.com/event?eid=event-1",
                    start: { dateTime: "2026-05-02T10:00:00.000Z" },
                  },
                ]
              : [],
          }),
          { status: 200 },
        );
      },
      adapters: {
        cornerstone: async () => ({
          source: "cornerstone",
          status: "unavailable",
          items: [],
          warnings: ["Cornerstone is offline."],
        }),
        notion: async () => ({
          source: "notion",
          status: "unavailable",
          items: [],
          warnings: ["Missing Notion config."],
        }),
      },
    });

    expect(requests.some((url) => url.includes("q=Nike"))).toBe(true);
    expect(authHeaders).toContain("Bearer calendar-token");
    expect(result.sources.find((source) => source.source === "calendar"))
      .toMatchObject({
        source: "calendar",
        status: "available",
        items: [
          {
            claim: "Calendar event: Nike QBR prep, 2026-05-02T10:00:00.000Z",
            source_type: "calendar",
            source_label: "Nike QBR prep",
            source_url: "https://calendar.google.com/event?eid=event-1",
          },
        ],
        warnings: [],
      });
  });

  it("keeps Calendar unavailable without blocking other retrieval when a token is unavailable", async () => {
    const result = await gatherWorkbenchRetrieval({
      ask: "Prep Nike QBR response",
      userId: "principal_without_token",
      apiKey: "csk_test",
      config: googleGrantedConfig(),
      now: new Date("2026-04-29T12:00:00.000Z"),
      googleAccessTokenProvider: async () => ({
        status: "unavailable",
        reason: "google_calendar_access_token_missing",
      }),
      adapters: {
        cornerstone: async () => ({
          source: "cornerstone",
          status: "available",
          items: [
            {
              claim: "Cornerstone note",
              source_type: "cornerstone",
              source_label: "Memory",
              source_url: null,
            },
          ],
          warnings: [],
        }),
        notion: async () => ({
          source: "notion",
          status: "unavailable",
          items: [],
          warnings: ["Missing Notion config."],
        }),
      },
    });

    expect(result.context).toEqual([
      {
        claim: "Cornerstone note",
        source_type: "cornerstone",
        source_label: "Memory",
        source_url: null,
      },
    ]);
    expect(result.sources.find((source) => source.source === "calendar"))
      .toMatchObject({
        source: "calendar",
        status: "unavailable",
        items: [],
        warnings: ["google_calendar_access_token_missing"],
      });
  });

  it("can use a stored Google token for Calendar retrieval without a custom provider", async () => {
    const authHeaders: Array<string | null> = [];
    const googleTokenStore: WorkbenchGoogleTokenStore = {
      async get(principalId) {
        expect(principalId).toBe("principal_with_stored_token");
        return {
          accessToken: "stored-access-token",
          refreshToken: "stored-refresh-token",
          expiresAtMs: Date.parse("2026-04-29T13:00:00.000Z"),
        };
      },
      async updateAccessToken() {
        throw new Error("refresh should not be needed");
      },
    };

    const result = await gatherWorkbenchRetrieval({
      ask: "Prep Nike QBR response",
      userId: "principal_with_stored_token",
      apiKey: "csk_test",
      config: googleGrantedConfig(),
      now: new Date("2026-04-29T12:00:00.000Z"),
      googleTokenStore,
      calendarFetch: async (_url, init) => {
        const headers = new Headers(init?.headers);
        authHeaders.push(headers.get("Authorization"));
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "event-1",
                summary: "Nike QBR prep",
                htmlLink: "https://calendar.google.com/event?eid=event-1",
                start: { dateTime: "2026-05-02T10:00:00.000Z" },
              },
            ],
          }),
          { status: 200 },
        );
      },
      adapters: {
        cornerstone: async () => ({
          source: "cornerstone",
          status: "unavailable",
          items: [],
          warnings: [],
        }),
        notion: async () => ({
          source: "notion",
          status: "unavailable",
          items: [],
          warnings: [],
        }),
      },
    });

    expect(authHeaders).toContain("Bearer stored-access-token");
    expect(result.sources.find((source) => source.source === "calendar"))
      .toMatchObject({
        source: "calendar",
        status: "available",
      });
  });

  it("keeps Calendar unavailable after Google disconnect even if a stored token remains", async () => {
    let tokenRequested = false;

    const result = await gatherWorkbenchRetrieval({
      ask: "Prep Nike QBR response",
      userId: "principal_revoked_google",
      apiKey: "csk_test",
      config: {
        ...googleGrantedConfig(),
        google_oauth_grant_status: "revoked",
        google_oauth_scopes: [],
      },
      now: new Date("2026-04-29T12:00:00.000Z"),
      googleAccessTokenProvider: async () => {
        tokenRequested = true;
        return { status: "available", accessToken: "stale-calendar-token" };
      },
      adapters: {
        cornerstone: async () => ({
          source: "cornerstone",
          status: "available",
          items: [],
          warnings: [],
        }),
        notion: async () => ({
          source: "notion",
          status: "available",
          items: [],
          warnings: [],
        }),
      },
    });

    expect(tokenRequested).toBe(false);
    expect(result.sources.find((source) => source.source === "calendar"))
      .toMatchObject({
        source: "calendar",
        status: "unavailable",
        items: [],
        warnings: ["google_oauth_grant_not_active"],
      });
  });
});

function googleGrantedConfig() {
  return {
    user_id: "principal_1",
    notion_parent_page_id: "notion-parent-1",
    drive_folder_id: "drive-folder-1",
    drive_folder_url: "https://drive.google.com/drive/folders/drive-folder-1",
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
