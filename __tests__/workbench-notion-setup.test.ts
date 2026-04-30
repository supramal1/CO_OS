import { describe, expect, it, vi } from "vitest";
import {
  WORKBENCH_NOTION_SETUP_CHILD_TITLES,
  ensureWorkbenchNotionSetup,
  type WorkbenchNotionSetupClient,
} from "@/lib/workbench/notion-setup";

type Page = {
  id: string;
  title: string;
  parentPageId: string | null;
  url: string | null;
};

function createSetupClient(initialPages: Page[] = []) {
  const pages = new Map(initialPages.map((page) => [page.id, { ...page }]));
  const calls: Array<
    | { operation: "listChildPages"; parentPageId: string }
    | { operation: "searchPagesByTitle"; title: string }
    | { operation: "createPage"; title: string; parentPageId: string | null }
  > = [];

  const client: WorkbenchNotionSetupClient = {
    async listChildPages(parentPageId) {
      calls.push({ operation: "listChildPages", parentPageId });
      if (!pages.has(parentPageId)) {
        throw new Error(`Page ${parentPageId} is inaccessible`);
      }
      return Array.from(pages.values())
        .filter((page) => page.parentPageId === parentPageId)
        .map(({ id, title, url }) => ({ id, title, url }));
    },
    async searchPagesByTitle(title) {
      calls.push({ operation: "searchPagesByTitle", title });
      return Array.from(pages.values())
        .filter((page) => page.title === title)
        .map(({ id, title, url }) => ({ id, title, url }));
    },
    async createPage(input) {
      calls.push({
        operation: "createPage",
        title: input.title,
        parentPageId: input.parentPageId ?? null,
      });
      const id = `${input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}-${pages.size + 1}`;
      const page = {
        id,
        title: input.title,
        parentPageId: input.parentPageId ?? null,
        url: `https://notion.so/${id}`,
      };
      pages.set(id, page);
      return page;
    },
  };

  return { client, calls, pages };
}

const existingWorkbenchPages: Page[] = [
  {
    id: "parent-1",
    title: "CO Workbench",
    parentPageId: null,
    url: "https://notion.so/parent-1",
  },
  ...WORKBENCH_NOTION_SETUP_CHILD_TITLES.map((title) => ({
    id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-page`,
    title,
    parentPageId: "parent-1",
    url: `https://notion.so/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  })),
];

describe("ensureWorkbenchNotionSetup", () => {
  it("validates an existing Workbench parent and does not create duplicate child pages", async () => {
    const { client, calls } = createSetupClient(existingWorkbenchPages);
    const updateConfig = vi.fn();

    const report = await ensureWorkbenchNotionSetup({
      userId: "principal_1",
      config: { notion_parent_page_id: "parent-1" },
      client,
      updateConfig,
    });

    expect(report).toEqual({
      status: "validated",
      parent_id: "parent-1",
      child_ids: {
        "Personal Profile": "personal-profile-page",
        "Working On": "working-on-page",
        Patterns: "patterns-page",
        References: "references-page",
        Voice: "voice-page",
      },
      counts: { created: 0, validated: 6, repaired: 0 },
    });
    expect(calls).toEqual([
      { operation: "listChildPages", parentPageId: "parent-1" },
    ]);
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("repairs only missing children under an accessible stored parent", async () => {
    const partialPages = existingWorkbenchPages.filter(
      (page) => !["Working On", "Voice"].includes(page.title),
    );
    const { client, calls } = createSetupClient(partialPages);

    const report = await ensureWorkbenchNotionSetup({
      userId: "principal_1",
      config: { notion_parent_page_id: "parent-1" },
      client,
    });

    expect(report.status).toBe("repaired");
    expect(report.parent_id).toBe("parent-1");
    expect(report.counts).toEqual({ created: 2, validated: 4, repaired: 2 });
    expect(report.child_ids).toMatchObject({
      "Personal Profile": "personal-profile-page",
      "Working On": "working-on-5",
      Patterns: "patterns-page",
      References: "references-page",
      Voice: "voice-6",
    });
    expect(calls).toEqual([
      { operation: "listChildPages", parentPageId: "parent-1" },
      {
        operation: "createPage",
        title: "Working On",
        parentPageId: "parent-1",
      },
      { operation: "createPage", title: "Voice", parentPageId: "parent-1" },
    ]);
  });

  it("creates a new Workbench parent and five children when the stored parent is inaccessible", async () => {
    const { client, calls } = createSetupClient([]);
    const updateConfig = vi.fn();

    const report = await ensureWorkbenchNotionSetup({
      userId: "principal_1",
      config: { notion_parent_page_id: "stale-parent" },
      client,
      updateConfig,
    });

    expect(report).toEqual({
      status: "created",
      parent_id: "co-workbench-1",
      child_ids: {
        "Personal Profile": "personal-profile-2",
        "Working On": "working-on-3",
        Patterns: "patterns-4",
        References: "references-5",
        Voice: "voice-6",
      },
      counts: { created: 6, validated: 0, repaired: 0 },
    });
    expect(calls).toEqual([
      { operation: "listChildPages", parentPageId: "stale-parent" },
      { operation: "searchPagesByTitle", title: "CO Workbench" },
      { operation: "createPage", title: "CO Workbench", parentPageId: null },
      {
        operation: "createPage",
        title: "Personal Profile",
        parentPageId: "co-workbench-1",
      },
      {
        operation: "createPage",
        title: "Working On",
        parentPageId: "co-workbench-1",
      },
      {
        operation: "createPage",
        title: "Patterns",
        parentPageId: "co-workbench-1",
      },
      {
        operation: "createPage",
        title: "References",
        parentPageId: "co-workbench-1",
      },
      {
        operation: "createPage",
        title: "Voice",
        parentPageId: "co-workbench-1",
      },
    ]);
    expect(updateConfig).toHaveBeenCalledWith({
      userId: "principal_1",
      notion_parent_page_id: "co-workbench-1",
    });
  });

  it("reuses an existing Workbench parent when config was disconnected", async () => {
    const { client, calls } = createSetupClient(existingWorkbenchPages);
    const updateConfig = vi.fn();

    const report = await ensureWorkbenchNotionSetup({
      userId: "principal_1",
      config: { notion_parent_page_id: null },
      client,
      updateConfig,
    });

    expect(report).toEqual({
      status: "validated",
      parent_id: "parent-1",
      child_ids: {
        "Personal Profile": "personal-profile-page",
        "Working On": "working-on-page",
        Patterns: "patterns-page",
        References: "references-page",
        Voice: "voice-page",
      },
      counts: { created: 0, validated: 6, repaired: 0 },
    });
    expect(calls).toEqual([
      { operation: "searchPagesByTitle", title: "CO Workbench" },
      { operation: "listChildPages", parentPageId: "parent-1" },
    ]);
    expect(updateConfig).toHaveBeenCalledWith({
      userId: "principal_1",
      notion_parent_page_id: "parent-1",
    });
  });

  it("chooses the existing Workbench parent with the most required children", async () => {
    const pages: Page[] = [
      { id: "sparse-parent", title: "CO Workbench", parentPageId: null, url: null },
      {
        id: "sparse-profile",
        title: "Personal Profile",
        parentPageId: "sparse-parent",
        url: null,
      },
      { id: "full-parent", title: "CO Workbench", parentPageId: null, url: null },
      ...WORKBENCH_NOTION_SETUP_CHILD_TITLES.map((title) => ({
        id: `full-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        title,
        parentPageId: "full-parent",
        url: null,
      })),
    ];
    const { client, calls } = createSetupClient(pages);
    const updateConfig = vi.fn();

    const report = await ensureWorkbenchNotionSetup({
      userId: "principal_1",
      config: { notion_parent_page_id: "stale-parent" },
      client,
      updateConfig,
    });

    expect(report.status).toBe("validated");
    expect(report.parent_id).toBe("full-parent");
    expect(report.counts).toEqual({ created: 0, validated: 6, repaired: 0 });
    expect(calls).toEqual([
      { operation: "listChildPages", parentPageId: "stale-parent" },
      { operation: "searchPagesByTitle", title: "CO Workbench" },
      { operation: "listChildPages", parentPageId: "sparse-parent" },
      { operation: "listChildPages", parentPageId: "full-parent" },
    ]);
    expect(updateConfig).toHaveBeenCalledWith({
      userId: "principal_1",
      notion_parent_page_id: "full-parent",
    });
  });

  it("repairs missing children under an existing searched Workbench parent", async () => {
    const partialPages = existingWorkbenchPages.filter(
      (page) => !["Patterns", "References"].includes(page.title),
    );
    const { client, calls } = createSetupClient(partialPages);
    const updateConfig = vi.fn();

    const report = await ensureWorkbenchNotionSetup({
      userId: "principal_1",
      config: null,
      client,
      updateConfig,
    });

    expect(report.status).toBe("repaired");
    expect(report.parent_id).toBe("parent-1");
    expect(report.counts).toEqual({ created: 2, validated: 4, repaired: 2 });
    expect(calls.filter((call) => call.operation === "createPage")).toEqual([
      { operation: "createPage", title: "Patterns", parentPageId: "parent-1" },
      { operation: "createPage", title: "References", parentPageId: "parent-1" },
    ]);
    expect(updateConfig).toHaveBeenCalledWith({
      userId: "principal_1",
      notion_parent_page_id: "parent-1",
    });
  });

  it("uses an explicit OAuth token boundary to create pages without a global token", async () => {
    const originalToken = process.env.NOTION_API_TOKEN;
    process.env.NOTION_API_TOKEN = "global-token-that-must-not-be-used";
    const requests: Array<{ url: string; init: RequestInit; title: string }> = [];
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/v1/search")) {
        return Response.json({ results: [] });
      }
      const body = JSON.parse(String(init?.body)) as {
        properties: { title: { title: Array<{ text: { content: string } }> } };
      };
      const title = body.properties.title.title[0].text.content;
      requests.push({ url: String(url), init: init ?? {}, title });
      return Response.json({
        id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        url: `https://notion.so/${title}`,
      });
    });

    try {
      const report = await ensureWorkbenchNotionSetup({
        userId: "principal_1",
        config: null,
        token: "oauth-token",
        fetch: fetcher,
      });

      expect(report.status).toBe("created");
      expect(report.parent_id).toBe("co-workbench");
      expect(requests.map((request) => request.title)).toEqual([
        "CO Workbench",
        "Personal Profile",
        "Working On",
        "Patterns",
        "References",
        "Voice",
      ]);
      expect(requests[0]).toMatchObject({
        url: "https://api.notion.com/v1/pages",
        init: {
          method: "POST",
          headers: {
            Authorization: "Bearer oauth-token",
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
          },
        },
      });
      expect(fetcher).toHaveBeenCalledTimes(7);
      expect(fetcher).toHaveBeenNthCalledWith(
        1,
        "https://api.notion.com/v1/search",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      if (originalToken === undefined) {
        delete process.env.NOTION_API_TOKEN;
      } else {
        process.env.NOTION_API_TOKEN = originalToken;
      }
    }
  });

  it("is safe to rerun after repair without creating duplicate pages", async () => {
    const partialPages = existingWorkbenchPages.filter(
      (page) => page.title !== "Voice",
    );
    const { client, calls } = createSetupClient(partialPages);

    const firstReport = await ensureWorkbenchNotionSetup({
      userId: "principal_1",
      config: { notion_parent_page_id: "parent-1" },
      client,
    });
    const secondReport = await ensureWorkbenchNotionSetup({
      userId: "principal_1",
      config: { notion_parent_page_id: "parent-1" },
      client,
    });

    expect(firstReport.status).toBe("repaired");
    expect(firstReport.counts).toEqual({ created: 1, validated: 5, repaired: 1 });
    expect(secondReport.status).toBe("validated");
    expect(secondReport.counts).toEqual({
      created: 0,
      validated: 6,
      repaired: 0,
    });
    expect(calls.filter((call) => call.operation === "createPage")).toEqual([
      { operation: "createPage", title: "Voice", parentPageId: "parent-1" },
    ]);
  });

  it("returns a failure report with reason when the Notion setup client is unavailable", async () => {
    const report = await ensureWorkbenchNotionSetup({
      userId: "principal_1",
      config: { notion_parent_page_id: null },
      client: null,
    });

    expect(report).toEqual({
      status: "failed",
      parent_id: null,
      child_ids: {},
      counts: { created: 0, validated: 0, repaired: 0 },
      reason: "notion_setup_client_missing",
    });
  });
});
