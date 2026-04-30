import type {
  WorkbenchNotionKnowledgePage,
  WorkbenchNotionPageSummary,
} from "./notion";
import type {
  WorkbenchNotionAppendBlock,
  WorkbenchNotionBlock,
} from "./notion-client";

export const WORKBENCH_NOTION_WRITABLE_PAGES = [
  "Personal Profile",
  "Working On",
  "Voice",
] as const;

export type WorkbenchNotionWritablePage =
  (typeof WORKBENCH_NOTION_WRITABLE_PAGES)[number];

export type WorkbenchNotionWriterClient = {
  listChildPages(parentPageId: string): Promise<WorkbenchNotionPageSummary[]>;
  appendBlockChildren(
    pageId: string,
    blocks: WorkbenchNotionAppendBlock[],
  ): Promise<WorkbenchNotionBlock[]>;
};

export type WorkbenchNotionPageAppenderClient = Pick<
  WorkbenchNotionWriterClient,
  "appendBlockChildren"
>;

export type WorkbenchNotionManagedSection = {
  page: WorkbenchNotionKnowledgePage | string;
  heading?: string | null;
  items: readonly string[];
  sourceLabel?: string | null;
};

export type WorkbenchNotionManagedSectionWrite = {
  page: WorkbenchNotionWritablePage;
  page_id: string;
  blocks_appended: number;
  item_count: number;
};

export type WorkbenchNotionManagedSectionResult =
  | {
      status: "written";
      writes: WorkbenchNotionManagedSectionWrite[];
      warnings: string[];
      reason?: never;
    }
  | {
      status: "skipped";
      reason:
        | "notion_writer_not_ready"
        | "no_writable_notion_sections";
      writes: WorkbenchNotionManagedSectionWrite[];
      warnings: string[];
    }
  | {
      status: "failed" | "partial";
      reason: string;
      writes: WorkbenchNotionManagedSectionWrite[];
      warnings: string[];
    };

export type AppendWorkbenchNotionManagedSectionsInput = {
  parentPageId?: string | null;
  client: WorkbenchNotionWriterClient | null;
  sections: readonly WorkbenchNotionManagedSection[];
  now?: Date;
};

export type AppendWorkbenchNotionManagedSectionToPageInput = {
  pageId?: string | null;
  client: WorkbenchNotionPageAppenderClient | null;
  section: WorkbenchNotionManagedSection;
  now?: Date;
};

const MAX_HEADING_CHARS = 80;
const MAX_ITEMS_PER_SECTION = 8;
const MAX_ITEM_CHARS = 240;
const DEFAULT_HEADING = "Update";
const DEFAULT_SOURCE_LABEL = "Workbench";

export async function appendWorkbenchNotionManagedSections(
  input: AppendWorkbenchNotionManagedSectionsInput,
): Promise<WorkbenchNotionManagedSectionResult> {
  const warnings: string[] = [];
  const parentPageId = input.parentPageId?.trim();
  if (!parentPageId) warnings.push("notion_parent_page_id_missing");
  if (!input.client) warnings.push("notion_writer_client_missing");

  if (!parentPageId || !input.client) {
    return {
      status: "skipped",
      reason: "notion_writer_not_ready",
      writes: [],
      warnings,
    };
  }

  let childPages: WorkbenchNotionPageSummary[];
  try {
    childPages = await input.client.listChildPages(parentPageId);
  } catch (error) {
    return {
      status: "failed",
      reason: `notion_child_page_lookup_failed: ${errorMessage(error)}`,
      writes: [],
      warnings,
    };
  }

  const pagesByTitle = new Map(childPages.map((page) => [page.title, page]));
  const writes: WorkbenchNotionManagedSectionWrite[] = [];

  for (const section of input.sections) {
    const pageTitle = normalizeText(section.page);
    if (!isWritablePage(pageTitle)) {
      warnings.push(`unsupported_notion_page: ${pageTitle || "unknown"}`);
      continue;
    }

    const targetPage = pagesByTitle.get(pageTitle);
    if (!targetPage?.id) {
      warnings.push(`notion_page_missing: ${pageTitle}`);
      continue;
    }

    const normalized = normalizeSection(section, pageTitle, warnings);
    if (normalized.items.length === 0) {
      warnings.push(`section_items_empty: ${pageTitle}`);
      continue;
    }

    const blocks = buildManagedSectionBlocks({
      heading: normalized.heading,
      items: normalized.items,
      sourceLabel: normalized.sourceLabel,
      now: input.now ?? new Date(),
    });

    try {
      await input.client.appendBlockChildren(targetPage.id, blocks);
      writes.push({
        page: pageTitle,
        page_id: targetPage.id,
        blocks_appended: blocks.length,
        item_count: normalized.items.length,
      });
    } catch (error) {
      return {
        status: writes.length > 0 ? "partial" : "failed",
        reason: `notion_append_failed: ${errorMessage(error)}`,
        writes,
        warnings,
      };
    }
  }

  if (writes.length === 0) {
    return {
      status: "skipped",
      reason: "no_writable_notion_sections",
      writes,
      warnings,
    };
  }

  return {
    status: "written",
    writes,
    warnings,
  };
}

export async function appendWorkbenchNotionManagedSectionToPage(
  input: AppendWorkbenchNotionManagedSectionToPageInput,
): Promise<WorkbenchNotionManagedSectionResult> {
  const warnings: string[] = [];
  const pageId = input.pageId?.trim();
  if (!pageId) warnings.push("notion_page_id_missing");
  if (!input.client) warnings.push("notion_writer_client_missing");

  if (!pageId || !input.client) {
    return {
      status: "skipped",
      reason: "notion_writer_not_ready",
      writes: [],
      warnings,
    };
  }

  const pageTitle = normalizeText(input.section.page);
  if (!isWritablePage(pageTitle)) {
    return {
      status: "skipped",
      reason: "no_writable_notion_sections",
      writes: [],
      warnings: [`unsupported_notion_page: ${pageTitle || "unknown"}`],
    };
  }

  const normalized = normalizeSection(input.section, pageTitle, warnings);
  if (normalized.items.length === 0) {
    return {
      status: "skipped",
      reason: "no_writable_notion_sections",
      writes: [],
      warnings: [...warnings, `section_items_empty: ${pageTitle}`],
    };
  }

  const blocks = buildManagedSectionBlocks({
    heading: normalized.heading,
    items: normalized.items,
    sourceLabel: normalized.sourceLabel,
    now: input.now ?? new Date(),
  });

  try {
    await input.client.appendBlockChildren(pageId, blocks);
  } catch (error) {
    return {
      status: "failed",
      reason: `notion_append_failed: ${errorMessage(error)}`,
      writes: [],
      warnings,
    };
  }

  return {
    status: "written",
    writes: [
      {
        page: pageTitle,
        page_id: pageId,
        blocks_appended: blocks.length,
        item_count: normalized.items.length,
      },
    ],
    warnings,
  };
}

function normalizeSection(
  section: WorkbenchNotionManagedSection,
  pageTitle: WorkbenchNotionWritablePage,
  warnings: string[],
): {
  heading: string;
  items: string[];
  sourceLabel: string;
} {
  let heading = normalizeText(section.heading);
  if (!heading) {
    warnings.push(`section_heading_empty: ${pageTitle}`);
    heading = DEFAULT_HEADING;
  }
  const headingResult = truncateText(heading, MAX_HEADING_CHARS);
  if (headingResult.truncated) {
    warnings.push(`section_heading_truncated: ${pageTitle}`);
  }

  const items: string[] = [];
  for (const rawItem of section.items) {
    const item = normalizeText(rawItem);
    if (!item) continue;
    const itemResult = truncateText(item, MAX_ITEM_CHARS);
    if (itemResult.truncated) {
      warnings.push(`section_item_truncated: ${pageTitle}`);
    }
    items.push(itemResult.value);
    if (items.length >= MAX_ITEMS_PER_SECTION) break;
  }

  const sourceLabel =
    truncateText(
      normalizeText(section.sourceLabel) || DEFAULT_SOURCE_LABEL,
      MAX_HEADING_CHARS,
    ).value || DEFAULT_SOURCE_LABEL;

  return {
    heading: headingResult.value,
    items,
    sourceLabel,
  };
}

function buildManagedSectionBlocks(input: {
  heading: string;
  items: readonly string[];
  sourceLabel: string;
  now: Date;
}): WorkbenchNotionAppendBlock[] {
  return [
    {
      type: "heading_3",
      heading_3: {
        rich_text: [text(`Workbench: ${input.heading}`)],
      },
    },
    {
      type: "paragraph",
      paragraph: {
        rich_text: [
          text(`Source: ${input.sourceLabel} | ${formatDate(input.now)}`),
        ],
      },
    },
    ...input.items.map(
      (item): WorkbenchNotionAppendBlock => ({
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [text(item)],
        },
      }),
    ),
  ];
}

function text(content: string) {
  return {
    type: "text" as const,
    text: { content },
  };
}

function isWritablePage(value: string): value is WorkbenchNotionWritablePage {
  return WORKBENCH_NOTION_WRITABLE_PAGES.includes(
    value as WorkbenchNotionWritablePage,
  );
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function truncateText(
  value: string,
  maxChars: number,
): { value: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { value, truncated: false };
  }
  return {
    value: `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`,
    truncated: true,
  };
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
