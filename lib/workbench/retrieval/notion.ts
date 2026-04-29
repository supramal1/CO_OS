import {
  WORKBENCH_NOTION_KNOWLEDGE_PAGES,
  retrieveWorkbenchNotionContext,
  type WorkbenchNotionClient,
  type WorkbenchNotionContextItem,
  type WorkbenchNotionKnowledgePage,
} from "../notion";
import { createWorkbenchNotionClient } from "../notion-client";
import {
  createWorkbenchNotionTokenStore,
  type WorkbenchNotionTokenStore,
} from "../notion-token-store";
import type { WorkbenchRetrievedContext } from "../types";
import {
  errorStatus,
  okStatus,
  unavailableStatus,
  type WorkbenchRetrievalAdapterResult,
  type WorkbenchUserConfig,
} from "./types";

export const WORKBENCH_NOTION_PAGE_NAMES = WORKBENCH_NOTION_KNOWLEDGE_PAGES;

export type WorkbenchNotionPageName = WorkbenchNotionKnowledgePage;

export type NotionPageContext = {
  pageName: WorkbenchNotionPageName;
  claim: string;
  url: string | null;
};

export type FetchNotionWorkbenchPages = (input: {
  parentPageId: string;
  pageNames: readonly WorkbenchNotionPageName[];
  ask: string;
}) => Promise<NotionPageContext[]>;

export type RetrieveNotionContextInput = {
  ask: string;
  userId: string;
  config: WorkbenchUserConfig | null;
  client?: WorkbenchNotionClient | null;
  fetchPages?: FetchNotionWorkbenchPages;
  notionTokenStore?: WorkbenchNotionTokenStore | null;
};

const NOTION_EXCERPT_MAX_CHARS = 680;
const NOTION_EMPTY_FIVE_PAGES_WARNING =
  "Notion is connected, but the five Workbench knowledge pages are empty.";

export async function retrieveNotionContext(
  input: RetrieveNotionContextInput,
): Promise<WorkbenchRetrievalAdapterResult> {
  if (!input.config?.notion_parent_page_id) {
    return {
      items: [],
      status: unavailableStatus("notion", "notion_parent_page_id_missing"),
    };
  }

  let clientBoundary: ReturnType<typeof createWorkbenchNotionClient> | null =
    null;
  try {
    clientBoundary =
      input.client === undefined ? await createDefaultNotionClient(input) : null;
  } catch (err) {
    return {
      items: [],
      status: errorStatus(
        "notion",
        `notion_token_lookup_failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    };
  }
  const client = input.client ?? clientBoundary?.client ?? null;

  if (client) {
    const result = await retrieveWorkbenchNotionContext({
      config: input.config,
      client,
      excerptMaxChars: NOTION_EXCERPT_MAX_CHARS,
    });
    const quality = prepareNotionItemsForRetrieval(
      result.items.map(notionItemToContext),
      input.ask,
    );
    return {
      items: quality.items,
      status:
        result.status.status === "ok"
          ? okStatus("notion", quality.items.length)
          : unavailableStatus("notion", result.status.reason),
      warnings: quality.warnings,
    };
  }

  if (clientBoundary?.status.status === "unavailable") {
    return {
      items: [],
      status: unavailableStatus("notion", clientBoundary.status.reason),
    };
  }

  if (!input.fetchPages) {
    return {
      items: [],
      status: unavailableStatus(
        "notion",
        "Notion adapter is prepared, but no Notion page fetcher is configured.",
      ),
    };
  }

  try {
    const pages = await input.fetchPages({
      parentPageId: input.config.notion_parent_page_id,
      pageNames: WORKBENCH_NOTION_PAGE_NAMES,
      ask: input.ask,
    });
    const quality = prepareNotionItemsForRetrieval(
      pages.map(pageToContext),
      input.ask,
    );
    return {
      items: quality.items,
      status: okStatus("notion", quality.items.length),
      warnings: quality.warnings,
    };
  } catch (err) {
    return {
      items: [],
      status: errorStatus(
        "notion",
        err instanceof Error ? err.message : String(err),
      ),
    };
  }
}

async function createDefaultNotionClient(
  input: RetrieveNotionContextInput,
): Promise<ReturnType<typeof createWorkbenchNotionClient>> {
  const tokenStore =
    input.notionTokenStore === undefined
      ? createWorkbenchNotionTokenStore()
      : input.notionTokenStore;
  let tokenLookupError: unknown = null;

  if (tokenStore) {
    try {
      const storedToken = await tokenStore.get(input.userId);
      if (storedToken?.accessToken) {
        return createWorkbenchNotionClient({ token: storedToken.accessToken });
      }
    } catch (error) {
      tokenLookupError = error;
    }
  }

  const fallbackClient = createWorkbenchNotionClient();
  if (tokenLookupError && fallbackClient.status.status === "unavailable") {
    throw tokenLookupError;
  }
  return fallbackClient;
}

function notionItemToContext(
  item: WorkbenchNotionContextItem,
): WorkbenchRetrievedContext {
  return item;
}

function pageToContext(page: NotionPageContext): WorkbenchRetrievedContext {
  const excerpt = excerptText(page.claim, NOTION_EXCERPT_MAX_CHARS);
  return {
    claim: `${page.pageName}: ${excerpt}`,
    source_type: "notion",
    source_label: page.pageName,
    source_url: page.url,
    metadata: {
      page_title: page.pageName,
      excerpt,
    },
  } as WorkbenchRetrievedContext;
}

type RetrievedNotionContext = WorkbenchRetrievedContext & {
  excerpt?: string;
  page_title?: WorkbenchNotionPageName;
  metadata?: {
    page_id?: string;
    page_title?: WorkbenchNotionPageName;
    excerpt?: string;
  };
};

function prepareNotionItemsForRetrieval(
  items: WorkbenchRetrievedContext[],
  ask: string,
): { items: WorkbenchRetrievedContext[]; warnings: string[] } {
  const normalizedItems = items.map(normalizeNotionItemExcerpt);
  const nonEmptyItems = normalizedItems.filter((item) =>
    getNotionExcerpt(item).trim(),
  );
  const warnings: string[] = [];

  if (
    normalizedItems.length === WORKBENCH_NOTION_PAGE_NAMES.length &&
    nonEmptyItems.length === 0
  ) {
    warnings.push(NOTION_EMPTY_FIVE_PAGES_WARNING);
  } else if (normalizedItems.length > 0 && nonEmptyItems.length === 0) {
    warnings.push("Notion is connected, but the matched Workbench pages are empty.");
  }

  return {
    items: rankNotionItems(nonEmptyItems, ask),
    warnings,
  };
}

function normalizeNotionItemExcerpt(
  item: WorkbenchRetrievedContext,
): WorkbenchRetrievedContext {
  const notionItem = item as RetrievedNotionContext;
  const pageTitle = getNotionPageTitle(notionItem);
  const excerpt = excerptText(getNotionExcerpt(notionItem), NOTION_EXCERPT_MAX_CHARS);
  const claim = pageTitle ? `${pageTitle}: ${excerpt}` : excerpt || item.claim;

  return {
    ...item,
    claim,
    excerpt,
    metadata: {
      ...(notionItem.metadata ?? {}),
      ...(pageTitle ? { page_title: pageTitle } : {}),
      excerpt,
    },
  } as WorkbenchRetrievedContext;
}

function rankNotionItems(
  items: WorkbenchRetrievedContext[],
  ask: string,
): WorkbenchRetrievedContext[] {
  const terms = extractAskTerms(ask);
  const lowerAsk = ask.toLowerCase();
  return items
    .map((item, index) => ({
      item,
      index,
      score: scoreNotionItem(item as RetrievedNotionContext, terms, lowerAsk),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((ranked) => ranked.item);
}

function scoreNotionItem(
  item: RetrievedNotionContext,
  terms: string[],
  lowerAsk: string,
): number {
  const pageTitle = getNotionPageTitle(item);
  const title = pageTitle.toLowerCase();
  const excerpt = getNotionExcerpt(item).toLowerCase();
  let score = 0;

  if (lowerAsk.includes(title)) score += 1000;
  for (const titlePart of title.split(/\s+/)) {
    if (titlePart.length > 2 && lowerAsk.includes(titlePart)) score += 150;
  }

  for (const term of terms) {
    const lowerTerm = term.toLowerCase();
    if (title.includes(lowerTerm)) score += 80;
    if (excerpt.includes(lowerTerm)) score += 25;
  }

  return score;
}

function extractAskTerms(ask: string): string[] {
  const terms: string[] = [];
  for (const match of ask.matchAll(/\b[A-Z][a-zA-Z0-9&.-]{1,}\b/g)) {
    addAskTerm(terms, match[0]);
  }
  for (const match of ask.matchAll(/\b[A-Z0-9]{2,}\b/g)) {
    addAskTerm(terms, match[0]);
  }
  for (const match of ask.matchAll(/\b[a-zA-Z][a-zA-Z0-9&.-]{4,}\b/g)) {
    addAskTerm(terms, match[0]);
  }
  return terms.slice(0, 12);
}

function addAskTerm(terms: string[], rawTerm: string): void {
  const term = rawTerm.trim().replace(/[.,:;!?)]$/, "");
  if (!term || NOTION_ASK_STOP_WORDS.has(term.toLowerCase())) return;
  if (terms.some((existing) => existing.toLowerCase() === term.toLowerCase())) {
    return;
  }
  terms.push(term);
}

const NOTION_ASK_STOP_WORDS = new Set([
  "about",
  "after",
  "client",
  "could",
  "from",
  "help",
  "page",
  "please",
  "prepare",
  "response",
  "this",
  "with",
]);

function getNotionPageTitle(
  item: RetrievedNotionContext,
): WorkbenchNotionPageName {
  const metadataTitle = item.metadata?.page_title;
  if (metadataTitle) return metadataTitle;
  if (item.page_title) return item.page_title;
  const label = item.source_label.replace(/^Notion:\s*/i, "").trim();
  return WORKBENCH_NOTION_PAGE_NAMES.includes(label as WorkbenchNotionPageName)
    ? (label as WorkbenchNotionPageName)
    : "References";
}

function getNotionExcerpt(item: RetrievedNotionContext): string {
  if (item.metadata?.excerpt !== undefined) return item.metadata.excerpt;
  if (item.excerpt !== undefined) return item.excerpt;
  const pageTitle = getNotionPageTitle(item);
  const prefix = `${pageTitle}:`;
  return item.claim.startsWith(prefix) ? item.claim.slice(prefix.length) : item.claim;
}

function excerptText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}
