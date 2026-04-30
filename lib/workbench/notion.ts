import type { WorkbenchRetrievedContext } from "./types";
import {
  normalizeWorkbenchNotionBlocks,
  type WorkbenchNotionAppendBlock,
  type WorkbenchNotionBlock,
} from "./notion-client";

export const WORKBENCH_NOTION_KNOWLEDGE_PAGES = [
  "Personal Profile",
  "Working On",
  "Patterns",
  "References",
  "Voice",
] as const;

export type WorkbenchNotionKnowledgePage =
  (typeof WORKBENCH_NOTION_KNOWLEDGE_PAGES)[number];

export type WorkbenchUserConfig = {
  user_id?: string;
  notion_parent_page_id?: string | null;
};

export type WorkbenchNotionPageSummary = {
  id: string;
  title: string;
  url?: string | null;
};

export type WorkbenchNotionClient = {
  listChildPages(parentPageId: string): Promise<WorkbenchNotionPageSummary[]>;
  getPageContent?(pageId: string): Promise<string>;
  getPageBlocks?(pageId: string): Promise<WorkbenchNotionBlock[]>;
  appendBlockChildren?(
    pageId: string,
    blocks: WorkbenchNotionAppendBlock[],
  ): Promise<WorkbenchNotionBlock[]>;
};

export type WorkbenchNotionContextItem = WorkbenchRetrievedContext & {
  page_id: string;
  page_title: WorkbenchNotionKnowledgePage;
  url: string | null;
  excerpt: string;
  metadata: {
    page_id: string;
    page_title: WorkbenchNotionKnowledgePage;
    excerpt: string;
  };
};

export type WorkbenchNotionRetrievalStatus =
  | {
      source: "notion";
      status: "ok";
      items_count: number;
    }
  | {
      source: "notion";
      status: "unavailable";
      reason:
        | "notion_parent_page_id_missing"
        | "notion_client_missing"
        | "notion_sdk_client_missing"
        | "notion_content_reader_missing";
      items_count: 0;
    };

export type WorkbenchNotionRetrievalResult = {
  items: WorkbenchNotionContextItem[];
  status: WorkbenchNotionRetrievalStatus;
};

export type RetrieveWorkbenchNotionContextInput = {
  config: WorkbenchUserConfig | null;
  client: WorkbenchNotionClient | null;
  excerptMaxChars?: number;
};

export async function retrieveWorkbenchNotionContext(
  input: RetrieveWorkbenchNotionContextInput,
): Promise<WorkbenchNotionRetrievalResult> {
  const parentPageId = input.config?.notion_parent_page_id?.trim();
  if (!parentPageId) {
    return unavailable("notion_parent_page_id_missing");
  }

  if (!input.client) {
    return unavailable("notion_client_missing");
  }
  const client = input.client;
  if (!client.getPageBlocks && !client.getPageContent) {
    return unavailable("notion_content_reader_missing");
  }

  const pagesByTitle = new Map(
    (await client.listChildPages(parentPageId)).map((page) => [
      page.title,
      page,
    ]),
  );

  const items = await Promise.all(
    WORKBENCH_NOTION_KNOWLEDGE_PAGES.flatMap((pageTitle) => {
      const page = pagesByTitle.get(pageTitle);
      return page ? [buildContextItem(client, pageTitle, page, input)] : [];
    }),
  );

  return {
    items,
    status: {
      source: "notion",
      status: "ok",
      items_count: items.length,
    },
  };
}

async function buildContextItem(
  client: WorkbenchNotionClient,
  pageTitle: WorkbenchNotionKnowledgePage,
  page: WorkbenchNotionPageSummary,
  input: RetrieveWorkbenchNotionContextInput,
): Promise<WorkbenchNotionContextItem> {
  const content = await getPageContent(client, page.id);
  const excerpt = excerptText(content, input.excerptMaxChars ?? 1200);
  const url = page.url ?? null;

  return {
    page_id: page.id,
    page_title: pageTitle,
    url,
    excerpt,
    metadata: {
      page_id: page.id,
      page_title: pageTitle,
      excerpt,
    },
    source_type: "notion",
    source_label: `Notion: ${pageTitle}`,
    source_url: url,
    claim: `${pageTitle}: ${excerpt}`,
  };
}

async function getPageContent(
  client: WorkbenchNotionClient,
  pageId: string,
): Promise<string> {
  if (client.getPageBlocks) {
    return normalizeWorkbenchNotionBlocks(await client.getPageBlocks(pageId));
  }

  if (client.getPageContent) {
    return client.getPageContent(pageId);
  }

  return "";
}

function unavailable(
  reason: Extract<
    WorkbenchNotionRetrievalStatus,
    { status: "unavailable" }
  >["reason"],
): WorkbenchNotionRetrievalResult {
  return {
    items: [],
    status: {
      source: "notion",
      status: "unavailable",
      reason,
      items_count: 0,
    },
  };
}

function excerptText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}
