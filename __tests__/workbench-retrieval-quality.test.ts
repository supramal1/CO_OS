import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gatherWorkbenchRetrieval } from "@/lib/workbench/retrieval";
import {
  extractCalendarKeywords,
  retrieveCalendarContext,
} from "@/lib/workbench/retrieval/calendar";
import { retrieveNotionContext } from "@/lib/workbench/retrieval/notion";
import type { WorkbenchNotionClient } from "@/lib/workbench/notion";

const WORKBENCH_CONFIG = {
  user_id: "principal_1",
  notion_parent_page_id: "parent-1",
  drive_folder_id: "drive-1",
  drive_folder_url: "https://drive.google.com/drive-1",
  google_oauth_grant_status: "granted",
  google_oauth_scopes: [],
  voice_register: null,
  feedback_style: null,
  friction_tasks: null,
};

describe("Workbench retrieval quality", () => {
  it("extracts entity, date, client, and deliverable terms from noisy asks", () => {
    const keywords = extractCalendarKeywords(
      "Hey, could you maybe help me pull together the follow-up deck for Acme Corp renewal on 12 May with Priya after Tuesday's client steering? thanks!",
    );

    expect(keywords).toEqual([
      "Acme Corp",
      "12 May",
      "Priya",
      "Tuesday",
      "Deck",
    ]);
    expect(keywords.join(" ")).not.toMatch(
      /\b(hey|could|maybe|help|pull|together|thanks)\b/i,
    );
  });

  it("ranks Calendar events by named entity, date, client, and deliverable matches", async () => {
    const calls: Array<string | undefined> = [];
    const result = await retrieveCalendarContext({
      ask: "Help pull together the follow-up deck for Acme Corp renewal on 12 May with Priya after Tuesday's client steering.",
      now: new Date("2026-04-29T12:00:00.000Z"),
      searchEvents: async (input) => {
        calls.push(input.query);
        return [
          {
            id: "weak-sync",
            title: "Weekly project sync",
            start: "2026-05-05T09:00:00.000Z",
            description: "General follow-up.",
            url: "https://calendar.google.com/event?eid=weak-sync",
          },
          {
            id: "strong-match",
            title: "Acme Corp renewal deck review with Priya",
            start: "2026-05-12T10:00:00.000Z",
            description:
              "Client steering follow-up deck for 12 May renewal decision.",
            url: "https://calendar.google.com/event?eid=strong-match",
          },
        ];
      },
    });

    expect(calls.slice(0, 2)).toEqual(["Acme Corp", "12 May"]);
    expect(calls).not.toEqual(expect.arrayContaining(["Help", "Pull"]));
    expect(result.items.map((item) => item.source_label)).toEqual([
      "Acme Corp renewal deck review with Priya",
      "Weekly project sync",
    ]);
    expect(result.items[0]?.claim).toContain("Acme Corp renewal deck review");
  });

  it("returns a Notion warning instead of empty context when all five pages are blank", async () => {
    const client = createNotionClientWithContent(() => "   \n  ");

    const result = await retrieveNotionContext({
      ask: "Prepare the client response",
      userId: "principal_1",
      config: WORKBENCH_CONFIG,
      client,
    });

    expect(result.items).toEqual([]);
    expect(result.status).toEqual({
      source: "notion",
      status: "ok",
      items_count: 0,
    });
    expect(result.warnings).toEqual([
      "Notion is connected, but the five Workbench knowledge pages are empty.",
    ]);
  });

  it("ranks exact Notion page and ask matches before generic pages and caps excerpts", async () => {
    const longVoiceGuidance = `${"Use short, direct language. ".repeat(
      50,
    )}Acme renewal response must cite sources.`;
    const client = createNotionClientWithContent((pageId) => {
      if (pageId === "voice-page") return longVoiceGuidance;
      if (pageId === "working-on-page") {
        return "Acme renewal response is the active client deliverable.";
      }
      return "General reference notes.";
    });

    const result = await retrieveNotionContext({
      ask: "Use the Voice page for the Acme renewal response.",
      userId: "principal_1",
      config: WORKBENCH_CONFIG,
      client,
    });

    expect(result.items[0]).toMatchObject({
      source_label: "Notion: Voice",
    });
    expect(result.items[0]?.claim.length).toBeLessThanOrEqual(720);
    expect(result.items[0]?.claim).toMatch(/\.\.\.$/);
    expect(result.items.map((item) => item.source_label)).toContain(
      "Notion: Working On",
    );
  });

  it("preserves partial results and emits source warnings in deterministic order", async () => {
    const result = await gatherWorkbenchRetrieval({
      ask: "Prep Acme renewal deck",
      userId: "principal_1",
      apiKey: "csk_test",
      config: null,
      now: new Date("2026-04-29T12:00:00.000Z"),
      adapters: {
        cornerstone: async () => ({
          items: [
            {
              claim: "Cornerstone memory: Acme renewal owner is Priya.",
              source_type: "cornerstone",
              source_label: "Memory",
              source_url: null,
            },
          ],
          status: {
            source: "cornerstone",
            status: "ok",
            items_count: 1,
          },
        }),
        notion: async () => ({
          items: [],
          status: {
            source: "notion",
            status: "ok",
            items_count: 0,
          },
          warnings: [
            "Notion is connected, but the five Workbench knowledge pages are empty.",
          ],
        }),
        calendar: async () => ({
          items: [
            {
              claim: "Calendar event: Acme renewal deck review, 2026-05-12T10:00:00.000Z",
              source_type: "calendar",
              source_label: "Acme renewal deck review",
              source_url: "https://calendar.google.com/event?eid=event-1",
            },
          ],
          status: {
            source: "calendar",
            status: "ok",
            items_count: 1,
          },
          warnings: [
            "Calendar returned context from a bounded scan because no keyword matches were found.",
          ],
        }),
      },
    });

    expect(result.context.map((item) => item.source_type)).toEqual([
      "cornerstone",
      "calendar",
    ]);
    expect(result.sources.map((source) => source.source)).toEqual([
      "cornerstone",
      "notion",
      "calendar",
    ]);
    expect(result.warnings).toEqual([
      "Notion is connected, but the five Workbench knowledge pages are empty.",
      "Calendar returned context from a bounded scan because no keyword matches were found.",
    ]);
  });

  it("keeps Gmail references out of Workbench retrieval code", () => {
    const retrievalCode = [
      "calendar.ts",
      "notion.ts",
      "index.ts",
      "types.ts",
    ]
      .map((file) =>
        readFileSync(
          join(process.cwd(), "lib", "workbench", "retrieval", file),
          "utf8",
        ),
      )
      .join("\n");

    expect(retrievalCode).not.toMatch(
      /gmail|googleapis\.com\/auth\/gmail|gmail\.compose|drafts/i,
    );
  });
});

function createNotionClientWithContent(
  getContent: (pageId: string) => string,
): WorkbenchNotionClient {
  return {
    async listChildPages(parentPageId) {
      expect(parentPageId).toBe("parent-1");
      return [
        {
          id: "profile-page",
          title: "Personal Profile",
          url: "https://notion.so/profile-page",
        },
        {
          id: "working-on-page",
          title: "Working On",
          url: "https://notion.so/working-on-page",
        },
        {
          id: "patterns-page",
          title: "Patterns",
          url: "https://notion.so/patterns-page",
        },
        {
          id: "references-page",
          title: "References",
          url: "https://notion.so/references-page",
        },
        {
          id: "voice-page",
          title: "Voice",
          url: "https://notion.so/voice-page",
        },
      ];
    },
    async getPageContent(pageId) {
      return getContent(pageId);
    },
  };
}
