import { describe, expect, it } from "vitest";
import {
  WORKBENCH_NOTION_KNOWLEDGE_PAGES,
  retrieveWorkbenchNotionContext,
  type WorkbenchNotionClient,
  type WorkbenchUserConfig,
} from "@/lib/workbench/notion";
import {
  createWorkbenchNotionClient,
  normalizeWorkbenchNotionBlocks,
  type WorkbenchNotionSdkClient,
} from "@/lib/workbench/notion-client";
import { getWorkbenchNotionRuntimeConfig } from "@/lib/workbench/notion-config";

describe("Workbench Notion adapter", () => {
  it("defines the five V1 knowledge pages", () => {
    expect(WORKBENCH_NOTION_KNOWLEDGE_PAGES).toEqual([
      "Personal Profile",
      "Working On",
      "Patterns",
      "References",
      "Voice",
    ]);
  });

  it("returns a typed unavailable result when config is missing", async () => {
    const result = await retrieveWorkbenchNotionContext({
      config: null,
      client: {
        listChildPages: async () => [],
        getPageContent: async () => "",
      },
    });

    expect(result).toEqual({
      items: [],
      status: {
        source: "notion",
        status: "unavailable",
        reason: "notion_parent_page_id_missing",
        items_count: 0,
      },
    });
  });

  it("returns a typed unavailable result when the Notion client is missing", async () => {
    const config: WorkbenchUserConfig = {
      user_id: "principal_1",
      notion_parent_page_id: "parent-1",
    };

    const result = await retrieveWorkbenchNotionContext({
      config,
      client: null,
    });

    expect(result).toEqual({
      items: [],
      status: {
        source: "notion",
        status: "unavailable",
        reason: "notion_client_missing",
        items_count: 0,
      },
    });
  });

  it("retrieves the five knowledge pages and returns source-shaped context blocks", async () => {
    const config: WorkbenchUserConfig = {
      user_id: "principal_1",
      notion_parent_page_id: "parent-1",
    };
    const client: WorkbenchNotionClient = {
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
          { id: "patterns-page", title: "Patterns", url: null },
          { id: "references-page", title: "References" },
          { id: "voice-page", title: "Voice" },
          { id: "ignored-page", title: "Archive" },
        ];
      },
      async getPageContent(pageId) {
        return `Content for ${pageId}. This page has details for the pre-flight context.`;
      },
    };

    const result = await retrieveWorkbenchNotionContext({
      config,
      client,
    });

    expect(result.status).toEqual({
      source: "notion",
      status: "ok",
      items_count: 5,
    });
    expect(result.items).toHaveLength(5);
    expect(result.items[0]).toEqual({
      page_id: "profile-page",
      page_title: "Personal Profile",
      url: "https://notion.so/profile-page",
      excerpt:
        "Content for profile-page. This page has details for the pre-flight context.",
      metadata: {
        page_id: "profile-page",
        page_title: "Personal Profile",
        excerpt:
          "Content for profile-page. This page has details for the pre-flight context.",
      },
      source_type: "notion",
      source_label: "Notion: Personal Profile",
      source_url: "https://notion.so/profile-page",
      claim:
        "Personal Profile: Content for profile-page. This page has details for the pre-flight context.",
    });
    expect(result.items.map((item) => item.page_title)).toEqual(
      WORKBENCH_NOTION_KNOWLEDGE_PAGES,
    );
  });

  it("normalizes typical Notion text blocks into retrieval-ready page content", () => {
    const content = normalizeWorkbenchNotionBlocks([
      {
        id: "heading",
        type: "heading_2",
        heading_2: {
          rich_text: [{ plain_text: "Current priorities" }],
        },
      },
      {
        id: "paragraph",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { plain_text: "Keep Workbench lean " },
            { plain_text: "and source-traced." },
          ],
        },
      },
      {
        id: "todo",
        type: "to_do",
        to_do: {
          checked: true,
          rich_text: [{ plain_text: "Avoid mail drafts in V1" }],
        },
      },
      {
        id: "bullet",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ plain_text: "Use Notion for knowledge" }],
        },
      },
      {
        id: "code",
        type: "code",
        code: {
          rich_text: [{ plain_text: "source_url !== null" }],
        },
      },
    ]);

    expect(content).toBe(
      [
        "Current priorities",
        "Keep Workbench lean and source-traced.",
        "[x] Avoid mail drafts in V1",
        "- Use Notion for knowledge",
        "source_url !== null",
      ].join("\n"),
    );
  });

  it("retrieves context from raw Notion blocks when a client exposes page blocks", async () => {
    const config: WorkbenchUserConfig = {
      user_id: "principal_1",
      notion_parent_page_id: "parent-1",
    };
    const client: WorkbenchNotionClient = {
      async listChildPages() {
        return [
          {
            id: "profile-page",
            title: "Personal Profile",
            url: "https://notion.so/profile-page",
          },
        ];
      },
      async getPageBlocks(pageId) {
        expect(pageId).toBe("profile-page");
        return [
          {
            id: "paragraph",
            type: "paragraph",
            paragraph: {
              rich_text: [{ plain_text: "Prefers concise, sourced context." }],
            },
          },
        ];
      },
    };

    const result = await retrieveWorkbenchNotionContext({ config, client });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      page_id: "profile-page",
      page_title: "Personal Profile",
      excerpt: "Prefers concise, sourced context.",
      metadata: {
        page_id: "profile-page",
        page_title: "Personal Profile",
        excerpt: "Prefers concise, sourced context.",
      },
      claim: "Personal Profile: Prefers concise, sourced context.",
      source_type: "notion",
      source_label: "Notion: Personal Profile",
      source_url: "https://notion.so/profile-page",
    });
  });

  it("adapts a Notion SDK-shaped client by listing the five V1 child pages from parent blocks", async () => {
    const calls: Array<{ block_id: string; start_cursor?: string }> = [];
    const sdkClient: WorkbenchNotionSdkClient = {
      search: async () => {
        throw new Error("search should not be used to list Workbench child pages");
      },
      blocks: {
        children: {
          list: async (args) => {
            calls.push({
              block_id: args.block_id,
              start_cursor: args.start_cursor,
            });
            if (args.block_id === "parent-1") {
              return {
                results: [
                  {
                    id: "profile-page",
                    type: "child_page",
                    child_page: { title: "Personal Profile" },
                  },
                  {
                    id: "working-on-page",
                    type: "child_page",
                    child_page: { title: "Working On" },
                  },
                  {
                    id: "patterns-page",
                    type: "child_page",
                    child_page: { title: "Patterns" },
                  },
                  {
                    id: "references-page",
                    type: "child_page",
                    child_page: { title: "References" },
                  },
                  {
                    id: "voice-page",
                    type: "child_page",
                    child_page: { title: "Voice" },
                  },
                  {
                    id: "ignored-paragraph",
                    type: "paragraph",
                    paragraph: {
                      rich_text: [{ plain_text: "Not a page." }],
                    },
                  },
                ],
              };
            }

            return {
              results: [
                {
                  id: "paragraph",
                  type: "paragraph",
                  paragraph: {
                    rich_text: [{ plain_text: `Live adapter text for ${args.block_id}.` }],
                  },
                },
              ],
            };
          },
        },
      },
    };

    const boundary = createWorkbenchNotionClient({ sdkClient });
    expect(boundary.status).toEqual({
      source: "notion",
      status: "ok",
      items_count: 0,
    });

    const result = await retrieveWorkbenchNotionContext({
      config: { notion_parent_page_id: "parent-1" },
      client: boundary.client,
    });

    expect(result.items[0]).toMatchObject({
      page_id: "profile-page",
      excerpt: "Live adapter text for profile-page.",
      source_label: "Notion: Personal Profile",
    });
    expect(result.items.map((item) => item.page_title)).toEqual(
      WORKBENCH_NOTION_KNOWLEDGE_PAGES,
    );
    expect(calls.map((call) => call.block_id)).toEqual([
      "parent-1",
      "profile-page",
      "working-on-page",
      "patterns-page",
      "references-page",
      "voice-page",
    ]);
  });

  it("paginates parent child-page listing and child page block content", async () => {
    const calls: Array<{ block_id: string; start_cursor?: string }> = [];
    const sdkClient: WorkbenchNotionSdkClient = {
      search: async () => {
        throw new Error("search should not be used to list Workbench child pages");
      },
      blocks: {
        children: {
          list: async (args) => {
            calls.push({
              block_id: args.block_id,
              start_cursor: args.start_cursor,
            });
            if (args.block_id === "parent-1" && !args.start_cursor) {
              return {
                results: [
                  {
                    id: "profile-page",
                    type: "child_page",
                    child_page: { title: "Personal Profile" },
                  },
                ],
                has_more: true,
                next_cursor: "parent-page-2",
              };
            }

            if (args.block_id === "parent-1" && args.start_cursor === "parent-page-2") {
              return {
                results: [
                  {
                    id: "voice-page",
                    type: "child_page",
                    child_page: { title: "Voice" },
                  },
                ],
              };
            }

            if (args.block_id === "profile-page" && !args.start_cursor) {
              return {
                results: [
                  {
                    id: "paragraph-1",
                    type: "paragraph",
                    paragraph: {
                      rich_text: [{ plain_text: "First content page." }],
                    },
                  },
                ],
                has_more: true,
                next_cursor: "content-page-2",
              };
            }

            if (args.block_id === "profile-page" && args.start_cursor === "content-page-2") {
              return {
                results: [
                  {
                    id: "paragraph-2",
                    type: "paragraph",
                    paragraph: {
                      rich_text: [{ plain_text: "Second content page." }],
                    },
                  },
                ],
              };
            }

            return { results: [] };
          },
        },
      },
    };

    const boundary = createWorkbenchNotionClient({ sdkClient });

    await expect(boundary.client?.listChildPages("parent-1")).resolves.toEqual([
      { id: "profile-page", title: "Personal Profile" },
      { id: "voice-page", title: "Voice" },
    ]);
    await expect(boundary.client?.getPageBlocks?.("profile-page")).resolves.toEqual([
      {
        id: "paragraph-1",
        type: "paragraph",
        paragraph: {
          rich_text: [{ plain_text: "First content page." }],
        },
      },
      {
        id: "paragraph-2",
        type: "paragraph",
        paragraph: {
          rich_text: [{ plain_text: "Second content page." }],
        },
      },
    ]);
    expect(calls).toEqual([
      { block_id: "parent-1", start_cursor: undefined },
      { block_id: "parent-1", start_cursor: "parent-page-2" },
      { block_id: "profile-page", start_cursor: undefined },
      { block_id: "profile-page", start_cursor: "content-page-2" },
    ]);
  });

  it("returns a typed unavailable boundary when no live Notion SDK client is configured", () => {
    const boundary = createWorkbenchNotionClient({ sdkClient: null });

    expect(boundary).toEqual({
      client: null,
      status: {
        source: "notion",
        status: "unavailable",
        reason: "notion_sdk_client_missing",
        items_count: 0,
      },
    });
  });

  it("returns typed runtime readiness when no Notion API token is configured", () => {
    const boundary = createWorkbenchNotionClient({ env: {} });

    expect(boundary).toEqual({
      client: null,
      status: {
        source: "notion",
        status: "unavailable",
        reason: "notion_api_token_missing",
        items_count: 0,
      },
    });
  });

  it("reads the Notion API token from runtime env without exposing user ids", () => {
    expect(
      getWorkbenchNotionRuntimeConfig({
        NOTION_API_TOKEN: " secret-token ",
      }),
    ).toEqual({
      status: "ready",
      apiToken: "secret-token",
      notionVersion: "2022-06-28",
    });

    expect(getWorkbenchNotionRuntimeConfig({})).toEqual({
      status: "unavailable",
      reason: "notion_api_token_missing",
    });
  });

  it("creates a dependency-free Notion REST client when a token is configured", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/v1/blocks/parent-1/children?page_size=100")) {
        return Response.json({
          results: [
            {
              id: "profile-page",
              type: "child_page",
              child_page: { title: "Personal Profile" },
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
              rich_text: [{ plain_text: "REST adapter text." }],
            },
          },
        ],
      });
    };

    const boundary = createWorkbenchNotionClient({
      token: "runtime-token",
      fetch: fetcher,
    });

    expect(boundary.status).toEqual({
      source: "notion",
      status: "ok",
      items_count: 0,
    });

    const result = await retrieveWorkbenchNotionContext({
      config: { notion_parent_page_id: "parent-1" },
      client: boundary.client,
    });

    expect(result.items[0]).toMatchObject({
      page_id: "profile-page",
      excerpt: "REST adapter text.",
      source_label: "Notion: Personal Profile",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: "https://api.notion.com/v1/blocks/parent-1/children?page_size=100",
      init: {
        method: "GET",
        headers: {
          Authorization: "Bearer runtime-token",
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
      },
    });
    expect(calls[1].url).toBe(
      "https://api.notion.com/v1/blocks/profile-page/children?page_size=100",
    );
  });
});
