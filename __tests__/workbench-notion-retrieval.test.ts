import { describe, expect, it, vi } from "vitest";
import {
  WORKBENCH_NOTION_PAGE_NAMES,
  retrieveNotionContext,
} from "@/lib/workbench/retrieval/notion";
import type { WorkbenchNotionClient } from "@/lib/workbench/notion";
import type { WorkbenchNotionTokenStore } from "@/lib/workbench/notion-token-store";

describe("Workbench Notion retrieval", () => {
  it("returns a typed unavailable state when user config is missing", async () => {
    const result = await retrieveNotionContext({
      ask: "Decode this ask",
      userId: "principal_1",
      config: null,
    });

    expect(result.items).toEqual([]);
    expect(result.status).toMatchObject({
      source: "notion",
      status: "unavailable",
    });
    expect(result.status.reason).toBe("notion_parent_page_id_missing");
  });

  it("defines the five V1 Workbench pages as the Notion retrieval target", () => {
    expect(WORKBENCH_NOTION_PAGE_NAMES).toEqual([
      "Personal Profile",
      "Working On",
      "Patterns",
      "References",
      "Voice",
    ]);
  });

  it("preserves Notion page metadata when using the live client boundary", async () => {
    const client: WorkbenchNotionClient = {
      async listChildPages() {
        return [
          {
            id: "voice-page",
            title: "Voice",
            url: "https://notion.so/voice-page",
          },
        ];
      },
      async getPageBlocks() {
        return [
          {
            id: "paragraph",
            type: "paragraph",
            paragraph: {
              rich_text: [{ plain_text: "Use short, direct status updates." }],
            },
          },
        ];
      },
    };

    const result = await retrieveNotionContext({
      ask: "Prepare a response",
      userId: "principal_1",
      config: {
        user_id: "principal_1",
        notion_parent_page_id: "parent-1",
        drive_folder_id: "drive-1",
        drive_folder_url: "https://drive.google.com/drive-1",
        google_oauth_grant_status: "granted",
        google_oauth_scopes: [],
        voice_register: null,
        feedback_style: null,
        friction_tasks: null,
      },
      client,
    });

    expect(result.status).toEqual({
      source: "notion",
      status: "ok",
      items_count: 1,
    });
    expect(result.items[0]).toMatchObject({
      claim: "Voice: Use short, direct status updates.",
      source_type: "notion",
      source_label: "Notion: Voice",
      source_url: "https://notion.so/voice-page",
      metadata: {
        page_id: "voice-page",
        page_title: "Voice",
        excerpt: "Use short, direct status updates.",
      },
    });
  });

  it("wires the default Notion REST client from NOTION_API_TOKEN", async () => {
    const originalToken = process.env.NOTION_API_TOKEN;
    process.env.NOTION_API_TOKEN = "runtime-token";
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/v1/blocks/parent-1/children?page_size=100")) {
        return Response.json({
          results: [
            {
              id: "voice-page",
              type: "child_page",
              child_page: { title: "Voice" },
            },
          ],
        });
      }

      return Response.json({
        results: [
          {
            id: "paragraph",
            type: "paragraph",
            paragraph: {
              rich_text: [{ plain_text: "Default runtime adapter text." }],
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetcher);

    try {
      const result = await retrieveNotionContext({
        ask: "Prepare a response",
        userId: "principal_1",
        config: {
          user_id: "principal_1",
          notion_parent_page_id: "parent-1",
          drive_folder_id: "drive-1",
          drive_folder_url: "https://drive.google.com/drive-1",
          google_oauth_grant_status: "granted",
          google_oauth_scopes: [],
          voice_register: null,
          feedback_style: null,
          friction_tasks: null,
        },
      });

      expect(result.status).toEqual({
        source: "notion",
        status: "ok",
        items_count: 1,
      });
      expect(result.items[0]).toMatchObject({
        claim: "Voice: Default runtime adapter text.",
        source_type: "notion",
        source_label: "Notion: Voice",
        source_url: null,
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      if (originalToken === undefined) {
        delete process.env.NOTION_API_TOKEN;
      } else {
        process.env.NOTION_API_TOKEN = originalToken;
      }
      vi.unstubAllGlobals();
    }
  });

  it("prefers the stored per-user Notion OAuth token for runtime retrieval", async () => {
    const originalToken = process.env.NOTION_API_TOKEN;
    delete process.env.NOTION_API_TOKEN;
    const authHeaders: Array<string | null> = [];
    const tokenStore: WorkbenchNotionTokenStore = {
      async get(principalId) {
        expect(principalId).toBe("principal_1");
        return {
          accessToken: "stored-notion-token",
          refreshToken: null,
          botId: null,
          workspaceId: null,
          workspaceName: null,
          duplicatedTemplateId: null,
        };
      },
    };
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      authHeaders.push(new Headers(init?.headers).get("Authorization"));
      if (String(url).endsWith("/v1/blocks/parent-1/children?page_size=100")) {
        return Response.json({
          results: [
            {
              id: "voice-page",
              type: "child_page",
              child_page: { title: "Voice" },
            },
          ],
        });
      }

      return Response.json({
        results: [
          {
            id: "paragraph",
            type: "paragraph",
            paragraph: {
              rich_text: [{ plain_text: "Stored token adapter text." }],
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetcher);

    try {
      const result = await retrieveNotionContext({
        ask: "Prepare a response",
        userId: "principal_1",
        config: {
          user_id: "principal_1",
          notion_parent_page_id: "parent-1",
          drive_folder_id: null,
          drive_folder_url: null,
          google_oauth_grant_status: null,
          google_oauth_scopes: null,
          voice_register: null,
          feedback_style: null,
          friction_tasks: null,
        },
        notionTokenStore: tokenStore,
      });

      expect(result.status).toEqual({
        source: "notion",
        status: "ok",
        items_count: 1,
      });
      expect(authHeaders).toEqual([
        "Bearer stored-notion-token",
        "Bearer stored-notion-token",
      ]);
    } finally {
      if (originalToken === undefined) {
        delete process.env.NOTION_API_TOKEN;
      } else {
        process.env.NOTION_API_TOKEN = originalToken;
      }
      vi.unstubAllGlobals();
    }
  });
});
