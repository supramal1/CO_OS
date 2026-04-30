import type {
  WorkbenchNotionClient,
  WorkbenchNotionPageSummary,
} from "./notion";
import {
  getWorkbenchNotionRuntimeConfig,
  type WorkbenchNotionRuntimeEnv,
} from "./notion-config";

export type WorkbenchNotionRichText = {
  plain_text?: string | null;
  text?: { content?: string | null } | null;
};

export type WorkbenchNotionBlock = {
  id?: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

export type WorkbenchNotionAppendRichText = {
  type: "text";
  text: { content: string };
};

export type WorkbenchNotionAppendBlock =
  | {
      type: "heading_3";
      heading_3: { rich_text: WorkbenchNotionAppendRichText[] };
    }
  | {
      type: "paragraph";
      paragraph: { rich_text: WorkbenchNotionAppendRichText[] };
    }
  | {
      type: "bulleted_list_item";
      bulleted_list_item: { rich_text: WorkbenchNotionAppendRichText[] };
    };

export type WorkbenchNotionSdkPage = {
  object?: string;
  id?: string;
  url?: string | null;
  parent?: { type?: string; page_id?: string | null };
  properties?: Record<string, unknown>;
};

export type WorkbenchNotionSdkCreatePageArgs = {
  parent?: { type: "page_id"; page_id: string } | { type: "workspace"; workspace: true };
  properties: {
    title: {
      title: Array<{ text: { content: string } }>;
    };
  };
};

export type WorkbenchNotionSdkAppendBlockChildrenArgs = {
  block_id: string;
  children: WorkbenchNotionAppendBlock[];
  after?: string;
};

export type WorkbenchNotionSdkClient = {
  search(args: {
    filter: { property: "object"; value: "page" };
    query?: string;
    page_size?: number;
    start_cursor?: string;
  }): Promise<{
    results: WorkbenchNotionSdkPage[];
    has_more?: boolean;
    next_cursor?: string | null;
  }>;
  blocks: {
    children: {
      list(args: {
        block_id: string;
        page_size?: number;
        start_cursor?: string;
      }): Promise<{
        results: WorkbenchNotionBlock[];
        has_more?: boolean;
        next_cursor?: string | null;
      }>;
      append?(
        args: WorkbenchNotionSdkAppendBlockChildrenArgs,
      ): Promise<{
        results: WorkbenchNotionBlock[];
        has_more?: boolean;
        next_cursor?: string | null;
      }>;
    };
  };
  pages?: {
    create(args: WorkbenchNotionSdkCreatePageArgs): Promise<WorkbenchNotionSdkPage>;
  };
};

export type CreateWorkbenchNotionClientInput = {
  sdkClient?: WorkbenchNotionSdkClient | null;
  token?: string | null;
  fetch?: typeof fetch;
  env?: WorkbenchNotionRuntimeEnv;
  notionVersion?: string;
  baseUrl?: string;
};

export type WorkbenchNotionClientStatus =
  | {
      source: "notion";
      status: "ok";
      items_count: 0;
    }
  | {
      source: "notion";
      status: "unavailable";
      reason: "notion_sdk_client_missing" | "notion_api_token_missing";
      items_count: 0;
    };

export type WorkbenchNotionClientBoundary =
  | {
      client: WorkbenchNotionClient;
      status: Extract<WorkbenchNotionClientStatus, { status: "ok" }>;
    }
  | {
      client: null;
      status: Extract<WorkbenchNotionClientStatus, { status: "unavailable" }>;
    };

export function createWorkbenchNotionClient(
  input: CreateWorkbenchNotionClientInput = {},
): WorkbenchNotionClientBoundary {
  if (input.sdkClient === null) {
    return {
      client: null,
      status: unavailable("notion_sdk_client_missing"),
    };
  }

  if (input.sdkClient) {
    return {
      client: new SdkWorkbenchNotionClient(input.sdkClient),
      status: ok(),
    };
  }

  const runtimeConfig = input.token?.trim()
    ? {
        status: "ready" as const,
        apiToken: input.token.trim(),
        notionVersion: input.notionVersion ?? "2022-06-28",
      }
    : getWorkbenchNotionRuntimeConfig(input.env);
  if (runtimeConfig.status === "unavailable") {
    return {
      client: null,
      status: unavailable(runtimeConfig.reason),
    };
  }

  return {
    client: new SdkWorkbenchNotionClient(
      new RestWorkbenchNotionSdkClient({
        token: runtimeConfig.apiToken,
        notionVersion: runtimeConfig.notionVersion,
        fetch: input.fetch,
        baseUrl: input.baseUrl,
      }),
    ),
    status: ok(),
  };
}

export function normalizeWorkbenchNotionBlocks(
  blocks: readonly WorkbenchNotionBlock[],
): string {
  return blocks
    .map(normalizeWorkbenchNotionBlock)
    .filter((line) => line.length > 0)
    .join("\n");
}

class SdkWorkbenchNotionClient implements WorkbenchNotionClient {
  constructor(private readonly sdkClient: WorkbenchNotionSdkClient) {}

  async listChildPages(parentPageId: string): Promise<WorkbenchNotionPageSummary[]> {
    const blocks: WorkbenchNotionBlock[] = [];
    let startCursor: string | undefined;

    do {
      const response = await this.sdkClient.blocks.children.list({
        block_id: parentPageId,
        page_size: 100,
        start_cursor: startCursor,
      });
      blocks.push(...response.results);
      startCursor = response.next_cursor ?? undefined;
      if (!response.has_more) break;
    } while (startCursor);

    return blocks
      .filter((block) => block.type === "child_page")
      .map((block) => ({
        id: block.id ?? "",
        title: extractChildPageTitle(block),
      }))
      .filter((page) => page.id && page.title);
  }

  async getPageBlocks(pageId: string): Promise<WorkbenchNotionBlock[]> {
    const blocks: WorkbenchNotionBlock[] = [];
    let startCursor: string | undefined;

    do {
      const response = await this.sdkClient.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: startCursor,
      });
      blocks.push(...response.results);
      startCursor = response.next_cursor ?? undefined;
      if (!response.has_more) break;
    } while (startCursor);

    return blocks;
  }

  async appendBlockChildren(
    pageId: string,
    blocks: WorkbenchNotionAppendBlock[],
  ): Promise<WorkbenchNotionBlock[]> {
    if (!this.sdkClient.blocks.children.append) {
      throw new Error("notion_block_appender_missing");
    }

    const response = await this.sdkClient.blocks.children.append({
      block_id: pageId,
      children: blocks,
    });
    return response.results;
  }

  async searchPagesByTitle(title: string): Promise<WorkbenchNotionPageSummary[]> {
    const normalizedTitle = normalizeTextValue(title);
    if (!normalizedTitle) return [];

    const pages: WorkbenchNotionPageSummary[] = [];
    let startCursor: string | undefined;

    do {
      const response = await this.sdkClient.search({
        query: normalizedTitle,
        filter: { property: "object", value: "page" },
        page_size: 100,
        start_cursor: startCursor,
      });
      pages.push(
        ...response.results
          .map((page) => ({
            id: page.id?.trim() ?? "",
            title: extractPageTitle(page),
            url: page.url ?? null,
          }))
          .filter((page) => page.id && page.title === normalizedTitle),
      );
      startCursor = response.next_cursor ?? undefined;
      if (!response.has_more) break;
    } while (startCursor);

    return pages;
  }

  async createPage(input: {
    title: string;
    parentPageId?: string | null;
  }): Promise<WorkbenchNotionPageSummary> {
    if (!this.sdkClient.pages?.create) {
      throw new Error("notion_page_creator_missing");
    }

    const page = await this.sdkClient.pages.create({
      parent: input.parentPageId?.trim()
        ? { type: "page_id", page_id: input.parentPageId.trim() }
        : { type: "workspace", workspace: true },
      properties: {
        title: {
          title: [{ text: { content: input.title } }],
        },
      },
    });
    const id = page.id?.trim();
    if (!id) {
      throw new Error("notion_created_page_id_missing");
    }

    return {
      id,
      title: input.title,
      url: page.url ?? null,
    };
  }
}

class RestWorkbenchNotionSdkClient implements WorkbenchNotionSdkClient {
  readonly blocks: WorkbenchNotionSdkClient["blocks"];
  readonly pages: NonNullable<WorkbenchNotionSdkClient["pages"]>;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly notionVersion: string;
  private readonly token: string;

  constructor(input: {
    token: string;
    notionVersion: string;
    fetch?: typeof fetch;
    baseUrl?: string;
  }) {
    this.token = input.token;
    this.notionVersion = input.notionVersion;
    this.fetcher = input.fetch ?? fetch;
    this.baseUrl = (input.baseUrl ?? "https://api.notion.com").replace(/\/$/, "");
    this.blocks = {
      children: {
        list: (args) => this.listBlockChildren(args),
        append: (args) => this.appendBlockChildren(args),
      },
    };
    this.pages = {
      create: (args) => this.createPage(args),
    };
  }

  async search(args: Parameters<WorkbenchNotionSdkClient["search"]>[0]) {
    return this.request("/v1/search", {
      method: "POST",
      body: JSON.stringify(withoutUndefined(args)),
    });
  }

  private async listBlockChildren(args: {
    block_id: string;
    page_size?: number;
    start_cursor?: string;
  }) {
    const params = new URLSearchParams();
    if (args.page_size !== undefined) params.set("page_size", String(args.page_size));
    if (args.start_cursor) params.set("start_cursor", args.start_cursor);
    const query = params.toString();
    return this.request(
      `/v1/blocks/${encodeURIComponent(args.block_id)}/children${
        query ? `?${query}` : ""
      }`,
      { method: "GET" },
    );
  }

  private async createPage(args: WorkbenchNotionSdkCreatePageArgs) {
    return this.request("/v1/pages", {
      method: "POST",
      body: JSON.stringify(args),
    });
  }

  private async appendBlockChildren(
    args: WorkbenchNotionSdkAppendBlockChildrenArgs,
  ) {
    return this.request(
      `/v1/blocks/${encodeURIComponent(args.block_id)}/children`,
      {
        method: "PATCH",
        body: JSON.stringify(
          withoutUndefined({
            children: args.children,
            after: args.after,
          }),
        ),
      },
    );
  }

  private async request(path: string, init: RequestInit) {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Notion-Version": this.notionVersion,
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Notion API request failed with status ${response.status}`);
    }

    return response.json();
  }
}

function normalizeWorkbenchNotionBlock(block: WorkbenchNotionBlock): string {
  const value = block[block.type] as Record<string, unknown> | undefined;
  if (!value) return "";

  if (block.type === "child_page") {
    return normalizeTextValue(value.title);
  }

  const text = richTextToPlainText(value.rich_text);
  if (!text) return "";

  if (block.type === "bulleted_list_item") return `- ${text}`;
  if (block.type === "numbered_list_item") return `1. ${text}`;
  if (block.type === "quote") return `> ${text}`;
  if (block.type === "to_do") return `[${value.checked ? "x" : " "}] ${text}`;

  return text;
}

function richTextToPlainText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map(normalizeRichText).join("").replace(/\s+/g, " ").trim();
}

function normalizeRichText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const richText = value as WorkbenchNotionRichText;
  return richText.plain_text ?? richText.text?.content ?? "";
}

function normalizeTextValue(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function extractChildPageTitle(block: WorkbenchNotionBlock): string {
  const value = block.child_page as Record<string, unknown> | undefined;
  return normalizeTextValue(value?.title);
}

function extractPageTitle(page: WorkbenchNotionSdkPage): string {
  const properties = page.properties ?? {};
  for (const property of Object.values(properties)) {
    if (!property || typeof property !== "object") continue;
    const value = property as { type?: unknown; title?: unknown };
    if (value.type !== "title") continue;
    return richTextToPlainText(value.title);
  }
  return "";
}

function unavailable(
  reason: Extract<WorkbenchNotionClientStatus, { status: "unavailable" }>["reason"],
): Extract<WorkbenchNotionClientStatus, { status: "unavailable" }> {
  return {
    source: "notion",
    status: "unavailable",
    reason,
    items_count: 0,
  };
}

function ok(): Extract<WorkbenchNotionClientStatus, { status: "ok" }> {
  return {
    source: "notion",
    status: "ok",
    items_count: 0,
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T;
}
