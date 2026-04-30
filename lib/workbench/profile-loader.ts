import "server-only";

import { listWorkbenchProfileUpdates } from "./learning";
import { retrieveWorkbenchNotionContext } from "./notion";
import { createWorkbenchNotionClient } from "./notion-client";
import { createWorkbenchNotionTokenStore } from "./notion-token-store";
import { compileWorkbenchProfile, type WorkbenchProfileContext } from "./profile";
import { getUserWorkbenchConfig } from "./retrieval/config";
import type { WorkbenchUserConfig } from "./retrieval/types";

export type WorkbenchProfileSourceStatus = {
  source: "notion" | "profile_updates";
  status: "ok" | "unavailable" | "error";
  items_count: number;
  reason?: string;
};

export type LoadWorkbenchProfileContextResult = {
  profile: WorkbenchProfileContext;
  config: WorkbenchUserConfig | null;
  sources: WorkbenchProfileSourceStatus[];
  generated_at: string;
};

export async function loadWorkbenchProfileContext(input: {
  userId: string;
  config?: WorkbenchUserConfig | null;
}): Promise<LoadWorkbenchProfileContextResult> {
  const config = input.config ?? (await getUserWorkbenchConfig(input.userId));
  const [notion, profileUpdates] = await Promise.all([
    loadNotionProfileItems(input.userId, config),
    listProfileUpdates(input.userId),
  ]);

  return {
    profile: compileWorkbenchProfile({
      notionItems: notion.items,
      userConfig: config,
      profileUpdates: profileUpdates.updates,
    }),
    config,
    sources: [notion.status, profileUpdates.status],
    generated_at: new Date().toISOString(),
  };
}

async function loadNotionProfileItems(
  userId: string,
  config: WorkbenchUserConfig | null,
) {
  if (!config?.notion_parent_page_id?.trim()) {
    return {
      items: [],
      status: unavailable("notion", "notion_parent_page_id_missing"),
    };
  }

  const token = await createWorkbenchNotionTokenStore()
    .get(userId)
    .then((stored) => stored?.accessToken?.trim() || null)
    .catch(() => null);
  if (!token) {
    return {
      items: [],
      status: unavailable("notion", "notion_oauth_required"),
    };
  }

  const boundary = createWorkbenchNotionClient({ token });
  if (!boundary.client) {
    return {
      items: [],
      status: unavailable("notion", boundary.status.reason),
    };
  }

  try {
    const result = await retrieveWorkbenchNotionContext({
      config,
      client: boundary.client,
      excerptMaxChars: 1200,
    });
    return {
      items: result.items,
      status: {
        source: "notion" as const,
        status: result.status.status === "ok" ? ("ok" as const) : ("unavailable" as const),
        items_count: result.status.items_count,
        ...(result.status.status === "unavailable"
          ? { reason: result.status.reason }
          : {}),
      },
    };
  } catch (err) {
    return {
      items: [],
      status: error("notion", errorMessage(err)),
    };
  }
}

async function listProfileUpdates(userId: string) {
  const result = await listWorkbenchProfileUpdates({ userId, limit: 40 });
  if (result.status === "ok") {
    return {
      updates: result.updates,
      status: {
        source: "profile_updates" as const,
        status: "ok" as const,
        items_count: result.updates.length,
      },
    };
  }

  return {
    updates: [],
    status:
      result.status === "unavailable"
        ? unavailable("profile_updates", result.error)
        : error("profile_updates", result.detail),
  };
}

function unavailable(
  source: WorkbenchProfileSourceStatus["source"],
  reason: string,
): WorkbenchProfileSourceStatus {
  return { source, status: "unavailable", items_count: 0, reason };
}

function error(
  source: WorkbenchProfileSourceStatus["source"],
  reason: string,
): WorkbenchProfileSourceStatus {
  return { source, status: "error", items_count: 0, reason };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
