import { describe, expect, it } from "vitest";
import {
  appendWorkbenchNotionManagedSectionToPage,
  appendWorkbenchNotionManagedSections,
  type WorkbenchNotionWriterClient,
} from "@/lib/workbench/notion-writer";
import type { WorkbenchNotionAppendBlock } from "@/lib/workbench/notion-client";

describe("Workbench Notion writer", () => {
  it("appends compact Workbench-managed sections to the existing writable pages", async () => {
    const appendCalls: Array<{
      pageId: string;
      blocks: WorkbenchNotionAppendBlock[];
    }> = [];
    const client: WorkbenchNotionWriterClient = {
      async listChildPages(parentPageId) {
        expect(parentPageId).toBe("parent-1");
        return [
          { id: "profile-page", title: "Personal Profile" },
          { id: "working-on-page", title: "Working On" },
          { id: "patterns-page", title: "Patterns" },
          { id: "references-page", title: "References" },
          { id: "voice-page", title: "Voice" },
        ];
      },
      async appendBlockChildren(pageId, blocks) {
        appendCalls.push({ pageId, blocks });
        return blocks.map((block, index) => ({
          id: `${pageId}-block-${index}`,
          ...block,
        }));
      },
    };

    const result = await appendWorkbenchNotionManagedSections({
      parentPageId: "parent-1",
      client,
      now: new Date("2026-04-30T10:00:00.000Z"),
      sections: [
        {
          page: "Personal Profile",
          heading: "Profile",
          items: [
            "  Strategy lead in AI Ops.  ",
            "Prefers concise, source-aware context.",
          ],
          sourceLabel: "Onboarding",
        },
        {
          page: "Working On",
          heading: "Current focus",
          items: ["Workbench personalisation sprint."],
          sourceLabel: "Onboarding",
        },
        {
          page: "Voice",
          heading: "Output preferences",
          items: ["Short, direct drafts with clear next actions."],
          sourceLabel: "Onboarding",
        },
      ],
    });

    expect(result).toEqual({
      status: "written",
      writes: [
        {
          page: "Personal Profile",
          page_id: "profile-page",
          blocks_appended: 4,
          item_count: 2,
        },
        {
          page: "Working On",
          page_id: "working-on-page",
          blocks_appended: 3,
          item_count: 1,
        },
        {
          page: "Voice",
          page_id: "voice-page",
          blocks_appended: 3,
          item_count: 1,
        },
      ],
      warnings: [],
    });
    expect(appendCalls.map((call) => call.pageId)).toEqual([
      "profile-page",
      "working-on-page",
      "voice-page",
    ]);
    expect(appendCalls[0].blocks).toEqual([
      {
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: "Workbench: Profile" } }],
        },
      },
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: "Source: Onboarding | 2026-04-30" },
            },
          ],
        },
      },
      {
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            { type: "text", text: { content: "Strategy lead in AI Ops." } },
          ],
        },
      },
      {
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: { content: "Prefers concise, source-aware context." },
            },
          ],
        },
      },
    ]);
  });

  it("skips unsupported pages and does not append arbitrary user content", async () => {
    const appendCalls: Array<{ pageId: string }> = [];
    const client: WorkbenchNotionWriterClient = {
      async listChildPages() {
        return [
          { id: "profile-page", title: "Personal Profile" },
          { id: "patterns-page", title: "Patterns" },
        ];
      },
      async appendBlockChildren(pageId) {
        appendCalls.push({ pageId });
        return [];
      },
    };

    const result = await appendWorkbenchNotionManagedSections({
      parentPageId: "parent-1",
      client,
      sections: [
        {
          page: "Patterns",
          heading: "Do not write",
          items: ["This task only allows Personal Profile, Working On, and Voice."],
        },
        {
          page: "Personal Profile",
          heading: "   ",
          items: ["   ", "A".repeat(400)],
          sourceLabel: "Learning",
        },
      ],
      now: new Date("2026-04-30T10:00:00.000Z"),
    });

    expect(result.status).toBe("written");
    expect(result.warnings).toEqual([
      "unsupported_notion_page: Patterns",
      "section_heading_empty: Personal Profile",
      "section_item_truncated: Personal Profile",
    ]);
    expect(appendCalls).toEqual([{ pageId: "profile-page" }]);
  });

  it("returns skipped without appending when the writer is not ready", async () => {
    const result = await appendWorkbenchNotionManagedSections({
      parentPageId: "",
      client: null,
      sections: [
        {
          page: "Voice",
          heading: "Output preferences",
          items: ["Use concise wording."],
        },
      ],
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "notion_writer_not_ready",
      writes: [],
      warnings: [
        "notion_parent_page_id_missing",
        "notion_writer_client_missing",
      ],
    });
  });

  it("appends a single managed section directly to a resolved page id", async () => {
    const appendCalls: Array<{
      pageId: string;
      blocks: WorkbenchNotionAppendBlock[];
    }> = [];

    const result = await appendWorkbenchNotionManagedSectionToPage({
      pageId: "voice-page",
      client: {
        async appendBlockChildren(pageId, blocks) {
          appendCalls.push({ pageId, blocks });
          return [];
        },
      },
      section: {
        page: "Voice",
        heading: "Workbench onboarding",
        items: ["Use concise outputs with clear next steps."],
        sourceLabel: "Onboarding",
      },
      now: new Date("2026-04-30T10:00:00.000Z"),
    });

    expect(result).toEqual({
      status: "written",
      writes: [
        {
          page: "Voice",
          page_id: "voice-page",
          blocks_appended: 3,
          item_count: 1,
        },
      ],
      warnings: [],
    });
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0].pageId).toBe("voice-page");
  });
});
