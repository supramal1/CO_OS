import { describe, expect, it } from "vitest";
import {
  compileWorkbenchProfile,
  type WorkbenchProfileContext,
} from "@/lib/workbench/profile";
import type {
  WorkbenchNotionContextItem,
  WorkbenchNotionKnowledgePage,
} from "@/lib/workbench/notion";
import type { WorkbenchProfileUpdateRow } from "@/lib/workbench/learning";

describe("compileWorkbenchProfile", () => {
  it("extracts stable profile fields from Notion profile pages", () => {
    const result = compileWorkbenchProfile({
      notionItems: [
        notionItem(
          "Personal Profile",
          [
            "Role: AI Ops lead",
            "Working context: Owns agency automation workflows",
            "Do not assume: They want speculative client claims",
          ].join("\n"),
          "https://notion.test/profile",
        ),
        notionItem("Working On", "Q2 retail search plan", "https://notion.test/work"),
        notionItem(
          "Voice",
          "Communication style: Short, direct bullets",
          "https://notion.test/voice",
        ),
      ],
      now: new Date("2026-04-30T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      role: "AI Ops lead",
      current_work: ["Q2 retail search plan"],
      communication_style: "Short, direct bullets",
      do_not_assume: ["They want speculative client claims"],
      updated_at: "2026-04-30T10:00:00.000Z",
    });
    expect(result.working_context).toContain("Owns agency automation workflows");
    expect(result.source_refs).toEqual(
      expect.arrayContaining([
        {
          source: "notion",
          label: "Notion: Personal Profile",
          url: "https://notion.test/profile",
          page_title: "Personal Profile",
        },
      ]),
    );
  });

  it("uses user config as fallback for voice, challenge, and friction context", () => {
    const result = compileWorkbenchProfile({
      userConfig: {
        user_id: "principal_1",
        notion_parent_page_id: "parent-secret-id",
        drive_folder_id: "drive-secret-id",
        drive_folder_url: "https://drive.test/folder",
        google_oauth_grant_status: "granted",
        google_oauth_scopes: [],
        voice_register: "Concise and plain-spoken",
        feedback_style: "Challenge weak assumptions early",
        friction_tasks: ["Long unstructured status decks"],
        updated_at: "2026-04-30T09:00:00.000Z",
      },
    });

    expect(result.communication_style).toBe("Concise and plain-spoken");
    expect(result.challenge_style).toBe("Challenge weak assumptions early");
    expect(result.do_not_assume).toEqual([
      "Friction task: Long unstructured status decks",
    ]);
    expect(result.source_refs).toContainEqual({
      source: "user_config",
      label: "Workbench user config",
      url: null,
      updated_at: "2026-04-30T09:00:00.000Z",
    });
    expect(result.summary_text).not.toContain("parent-secret-id");
    expect(result.summary_text).not.toContain("drive-secret-id");
  });

  it("applies written profile-update ledger rows and ignores undone or skipped rows", () => {
    const result = compileWorkbenchProfile({
      profileUpdates: [
        profileUpdate({
          id: "update-written-2",
          target_page: "Working On",
          candidate_text: "Currently preparing the Nike QBR narrative.",
          status: "written",
          created_at: "2026-04-30T09:00:00.000Z",
          updated_at: "2026-04-30T09:30:00.000Z",
        }),
        profileUpdate({
          id: "update-skipped",
          target_page: "Voice",
          candidate_text: "Skipped voice detail",
          status: "skipped",
        }),
        profileUpdate({
          id: "update-undone",
          target_page: "Voice",
          candidate_text: "Undone voice detail",
          status: "undone",
          undone_at: "2026-04-30T10:00:00.000Z",
        }),
        profileUpdate({
          id: "update-written-1",
          target_page: "Voice",
          candidate_text: "Prefers source-traced bullets.",
          status: "written",
          created_at: "2026-04-30T08:00:00.000Z",
          updated_at: "2026-04-30T08:15:00.000Z",
        }),
      ],
    });

    expect(result.current_work).toEqual([
      "Currently preparing the Nike QBR narrative.",
    ]);
    expect(result.communication_style).toBe("Prefers source-traced bullets.");
    expect(result.updated_at).toBe("2026-04-30T09:30:00.000Z");
    expect(result.summary_text).not.toContain("Skipped voice detail");
    expect(result.summary_text).not.toContain("Undone voice detail");
    expect(result.source_refs.filter((ref) => ref.source === "profile_update"))
      .toHaveLength(2);
  });

  it("preserves source refs without leaking raw IDs into summary text", () => {
    const result = compileWorkbenchProfile({
      notionItems: [
        notionItem(
          "Personal Profile",
          "Role: Operator for page profile-page-secret-123",
          "https://notion.test/profile-page-secret-123",
        ),
      ],
      profileUpdates: [
        profileUpdate({
          id: "profile-update-secret-456",
          target_page: "References",
          candidate_text:
            "Working context: Use csk_secret_123456789 and profile-page-secret-123 as internal IDs.",
          status: "written",
        }),
      ],
      now: new Date("2026-04-30T10:00:00.000Z"),
    });

    expect(result.source_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "notion",
          url: "https://notion.test/profile-page-secret-123",
        }),
        expect.objectContaining({
          source: "profile_update",
          label: "Profile update: References",
        }),
      ]),
    );
    expectNoRawIds(result);
  });
});

function notionItem(
  pageTitle: WorkbenchNotionKnowledgePage,
  excerpt: string,
  url: string | null,
): WorkbenchNotionContextItem {
  return {
    page_id: `${pageTitle.toLowerCase().replace(/\s+/g, "-")}-id`,
    page_title: pageTitle,
    url,
    excerpt,
    metadata: {
      page_id: `${pageTitle.toLowerCase().replace(/\s+/g, "-")}-id`,
      page_title: pageTitle,
      excerpt,
    },
    source_type: "notion",
    source_label: `Notion: ${pageTitle}`,
    source_url: url,
    claim: `${pageTitle}: ${excerpt}`,
  };
}

function profileUpdate(
  overrides: Partial<WorkbenchProfileUpdateRow>,
): WorkbenchProfileUpdateRow {
  return {
    id: "update-id",
    user_id: "principal_1",
    target_page: "Personal Profile",
    source_run_id: "run-secret-id",
    candidate_text: "Role: Operator",
    status: "written",
    classification: {},
    source_signal: null,
    confidence: null,
    previous_value: null,
    new_value: null,
    user_decision: null,
    notion_page_id: "notion-page-secret-id",
    notion_block_id: "notion-block-secret-id",
    undo_of_update_id: null,
    undo_reason: null,
    undo_metadata: null,
    undone_at: null,
    created_at: "2026-04-30T08:00:00.000Z",
    updated_at: "2026-04-30T08:00:00.000Z",
    ...overrides,
  };
}

function expectNoRawIds(context: WorkbenchProfileContext): void {
  expect(context.summary_text).not.toContain("profile-page-secret-123");
  expect(context.summary_text).not.toContain("profile-update-secret-456");
  expect(context.summary_text).not.toContain("csk_secret_123456789");
  expect(context.summary_text).not.toContain("notion-page-secret-id");
}
