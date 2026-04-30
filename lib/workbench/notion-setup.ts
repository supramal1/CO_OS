import {
  WORKBENCH_NOTION_KNOWLEDGE_PAGES,
  type WorkbenchNotionKnowledgePage,
  type WorkbenchNotionPageSummary,
} from "./notion";
import { createWorkbenchNotionClient } from "./notion-client";

export const WORKBENCH_NOTION_SETUP_PARENT_TITLE = "CO Workbench";
export const WORKBENCH_NOTION_SETUP_CHILD_TITLES =
  WORKBENCH_NOTION_KNOWLEDGE_PAGES;

export type WorkbenchNotionSetupChildTitle = WorkbenchNotionKnowledgePage;

export type WorkbenchNotionSetupConfig = {
  notion_parent_page_id?: string | null;
};

export type WorkbenchNotionCreatePageInput = {
  title: string;
  parentPageId?: string | null;
};

export type WorkbenchNotionSetupClient = {
  listChildPages(parentPageId: string): Promise<WorkbenchNotionPageSummary[]>;
  createPage(
    input: WorkbenchNotionCreatePageInput,
  ): Promise<WorkbenchNotionPageSummary>;
};

export type WorkbenchNotionSetupCounts = {
  created: number;
  validated: number;
  repaired: number;
};

export type WorkbenchNotionSetupChildIds = Partial<
  Record<WorkbenchNotionSetupChildTitle, string>
>;

export type WorkbenchNotionSetupReport =
  | {
      status: "validated" | "repaired" | "created";
      parent_id: string;
      child_ids: Record<WorkbenchNotionSetupChildTitle, string>;
      counts: WorkbenchNotionSetupCounts;
      reason?: never;
    }
  | {
      status: "failed";
      parent_id: string | null;
      child_ids: WorkbenchNotionSetupChildIds;
      counts: WorkbenchNotionSetupCounts;
      reason: string;
    };

export type WorkbenchNotionSetupInput = {
  userId: string;
  config: WorkbenchNotionSetupConfig | null;
  client?: WorkbenchNotionSetupClient | null;
  token?: string | null;
  fetch?: typeof fetch;
  updateConfig?: (input: {
    userId: string;
    notion_parent_page_id: string;
  }) => Promise<void> | void;
};

export async function ensureWorkbenchNotionSetup(
  input: WorkbenchNotionSetupInput,
): Promise<WorkbenchNotionSetupReport> {
  const resolvedClient = resolveSetupClient(input);
  if (!resolvedClient.client) {
    return failed({
      reason: resolvedClient.reason,
      parentId: null,
      childIds: {},
      counts: emptyCounts(),
    });
  }

  const client = resolvedClient.client;
  const storedParentId = input.config?.notion_parent_page_id?.trim() || null;
  if (storedParentId) {
    const storedParentChildren = await listStoredParentChildren(
      client,
      storedParentId,
    );
    if (storedParentChildren) {
      return ensureChildPages({
        client,
        parentId: storedParentId,
        existingChildren: storedParentChildren,
      });
    }
  }

  return createWorkbenchPages({
    userId: input.userId,
    client,
    updateConfig: input.updateConfig,
  });
}

async function listStoredParentChildren(
  client: WorkbenchNotionSetupClient,
  parentId: string,
): Promise<WorkbenchNotionPageSummary[] | null> {
  try {
    return await client.listChildPages(parentId);
  } catch {
    return null;
  }
}

async function ensureChildPages(input: {
  client: WorkbenchNotionSetupClient;
  parentId: string;
  existingChildren: readonly WorkbenchNotionPageSummary[];
}): Promise<WorkbenchNotionSetupReport> {
  const counts = emptyCounts();
  const childIds: WorkbenchNotionSetupChildIds = {};
  const existingByTitle = childPageByTitle(input.existingChildren);

  counts.validated += 1;

  try {
    for (const title of WORKBENCH_NOTION_SETUP_CHILD_TITLES) {
      const existing = existingByTitle.get(title);
      if (existing) {
        childIds[title] = existing.id;
        counts.validated += 1;
        continue;
      }

      const created = await input.client.createPage({
        title,
        parentPageId: input.parentId,
      });
      childIds[title] = created.id;
      counts.created += 1;
      counts.repaired += 1;
    }
  } catch (error) {
    return failed({
      reason: errorMessage(error),
      parentId: input.parentId,
      childIds,
      counts,
    });
  }

  const completeChildIds = completeChildIdsOrNull(childIds);
  if (!completeChildIds) {
    return failed({
      reason: "notion_setup_child_ids_incomplete",
      parentId: input.parentId,
      childIds,
      counts,
    });
  }

  return {
    status: counts.repaired > 0 ? "repaired" : "validated",
    parent_id: input.parentId,
    child_ids: completeChildIds,
    counts,
  };
}

async function createWorkbenchPages(input: {
  userId: string;
  client: WorkbenchNotionSetupClient;
  updateConfig?: WorkbenchNotionSetupInput["updateConfig"];
}): Promise<WorkbenchNotionSetupReport> {
  const counts = emptyCounts();
  const childIds: WorkbenchNotionSetupChildIds = {};
  let parentId: string | null = null;

  try {
    const parent = await input.client.createPage({
      title: WORKBENCH_NOTION_SETUP_PARENT_TITLE,
      parentPageId: null,
    });
    parentId = parent.id;
    counts.created += 1;

    for (const title of WORKBENCH_NOTION_SETUP_CHILD_TITLES) {
      const child = await input.client.createPage({
        title,
        parentPageId: parentId,
      });
      childIds[title] = child.id;
      counts.created += 1;
    }

    await input.updateConfig?.({
      userId: input.userId,
      notion_parent_page_id: parentId,
    });
  } catch (error) {
    return failed({
      reason: errorMessage(error),
      parentId,
      childIds,
      counts,
    });
  }

  const completeChildIds = completeChildIdsOrNull(childIds);
  if (!completeChildIds || !parentId) {
    return failed({
      reason: "notion_setup_page_ids_incomplete",
      parentId,
      childIds,
      counts,
    });
  }

  return {
    status: "created",
    parent_id: parentId,
    child_ids: completeChildIds,
    counts,
  };
}

function resolveSetupClient(input: WorkbenchNotionSetupInput):
  | { client: WorkbenchNotionSetupClient; reason?: never }
  | { client: null; reason: string } {
  if (input.client === null) {
    return { client: null, reason: "notion_setup_client_missing" };
  }
  if (input.client) return { client: input.client };

  const boundary = createWorkbenchNotionClient({
    token: input.token,
    fetch: input.fetch,
    env: {},
  });
  if (boundary.status.status === "unavailable") {
    return { client: null, reason: boundary.status.reason };
  }
  if (!isSetupClient(boundary.client)) {
    return { client: null, reason: "notion_page_creator_missing" };
  }

  return { client: boundary.client };
}

function childPageByTitle(
  pages: readonly WorkbenchNotionPageSummary[],
): Map<WorkbenchNotionSetupChildTitle, WorkbenchNotionPageSummary> {
  const byTitle = new Map<
    WorkbenchNotionSetupChildTitle,
    WorkbenchNotionPageSummary
  >();
  for (const page of pages) {
    if (isWorkbenchChildTitle(page.title) && !byTitle.has(page.title)) {
      byTitle.set(page.title, page);
    }
  }
  return byTitle;
}

function completeChildIdsOrNull(
  childIds: WorkbenchNotionSetupChildIds,
): Record<WorkbenchNotionSetupChildTitle, string> | null {
  const complete = {} as Record<WorkbenchNotionSetupChildTitle, string>;
  for (const title of WORKBENCH_NOTION_SETUP_CHILD_TITLES) {
    const id = childIds[title]?.trim();
    if (!id) return null;
    complete[title] = id;
  }
  return complete;
}

function isWorkbenchChildTitle(
  value: string,
): value is WorkbenchNotionSetupChildTitle {
  return WORKBENCH_NOTION_SETUP_CHILD_TITLES.includes(
    value as WorkbenchNotionSetupChildTitle,
  );
}

function isSetupClient(value: unknown): value is WorkbenchNotionSetupClient {
  if (!value || typeof value !== "object") return false;
  const client = value as Partial<WorkbenchNotionSetupClient>;
  return (
    typeof client.listChildPages === "function" &&
    typeof client.createPage === "function"
  );
}

function emptyCounts(): WorkbenchNotionSetupCounts {
  return { created: 0, validated: 0, repaired: 0 };
}

function failed(input: {
  reason: string;
  parentId: string | null;
  childIds: WorkbenchNotionSetupChildIds;
  counts: WorkbenchNotionSetupCounts;
}): Extract<WorkbenchNotionSetupReport, { status: "failed" }> {
  return {
    status: "failed",
    parent_id: input.parentId,
    child_ids: input.childIds,
    counts: input.counts,
    reason: input.reason,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
