import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ensureWorkbenchDriveSetup } from "@/lib/workbench/google-drive-setup";
import {
  WORKBENCH_GOOGLE_CONNECTOR_SCOPES,
  WORKBENCH_GOOGLE_OAUTH_SCOPE,
} from "@/lib/workbench/google-auth";
import {
  WORKBENCH_NOTION_SETUP_CHILD_TITLES,
  ensureWorkbenchNotionSetup,
  type WorkbenchNotionCreatePageInput,
  type WorkbenchNotionSetupClient,
} from "@/lib/workbench/notion-setup";
import { findWorkbenchRuntimeMatches } from "./helpers/workbench-runtime-scan";

type SetupConfig = {
  user_id: string;
  notion_parent_page_id: string | null;
  drive_folder_id: string | null;
  drive_folder_url: string | null;
};

type SetupConfigUpdate = {
  userId: string;
  notion_parent_page_id?: string;
  drive_folder_id?: string;
  drive_folder_url?: string;
};

type NotionPage = {
  id: string;
  title: string;
  url: string;
  parentPageId: string | null;
  deleted: boolean;
};

type DriveFolder = {
  id: string;
  url: string;
  deleted: boolean;
};

describe("Workbench V1 hardening", () => {
  it("connects Notion and Drive once, then repairs missing resources without active duplicates", async () => {
    const setup = createWorkbenchSetupHarness();

    const first = await runConnectorSetup(setup);
    const firstNotionParentId = first.config.notion_parent_page_id;
    const firstDriveFolderId = first.config.drive_folder_id;

    expect(first.notion).toMatchObject({
      status: "created",
      parent_id: firstNotionParentId,
      counts: {
        created: WORKBENCH_NOTION_SETUP_CHILD_TITLES.length + 1,
        validated: 0,
        repaired: 0,
      },
    });
    expect(first.drive).toMatchObject({
      status: "ready",
      reason: "created",
      repaired: false,
      drive_folder_id: firstDriveFolderId,
    });

    const second = await runConnectorSetup(setup);

    expect(second.config.notion_parent_page_id).toBe(firstNotionParentId);
    expect(second.config.drive_folder_id).toBe(firstDriveFolderId);
    expect(notionCreateCalls(setup.calls.notion)).toHaveLength(
      WORKBENCH_NOTION_SETUP_CHILD_TITLES.length + 1,
    );
    expect(driveCreateCalls(setup.calls.drive)).toHaveLength(1);
    expect(second.notion).toMatchObject({
      status: "validated",
      counts: {
        created: 0,
        validated: WORKBENCH_NOTION_SETUP_CHILD_TITLES.length + 1,
        repaired: 0,
      },
    });
    expect(second.drive).toMatchObject({
      status: "ready",
      reason: "existing_valid",
      repaired: false,
      drive_folder_id: firstDriveFolderId,
    });

    setup.deleteNotionChild(firstNotionParentId, "Voice");
    setup.deleteDriveFolder(firstDriveFolderId);

    const repaired = await runConnectorSetup(setup);

    expect(repaired.config.notion_parent_page_id).toBe(firstNotionParentId);
    expect(repaired.config.drive_folder_id).not.toBe(firstDriveFolderId);
    expect(repaired.notion).toMatchObject({
      status: "repaired",
      parent_id: firstNotionParentId,
      counts: {
        created: 1,
        validated: WORKBENCH_NOTION_SETUP_CHILD_TITLES.length,
        repaired: 1,
      },
    });
    expect(repaired.drive).toMatchObject({
      status: "ready",
      reason: "resource_missing",
      repaired: true,
      drive_folder_id: repaired.config.drive_folder_id,
    });
    expect(activeNotionChildTitles(setup.pages, firstNotionParentId)).toEqual([
      ...WORKBENCH_NOTION_SETUP_CHILD_TITLES,
    ].sort());
    expect(activeDriveFolderIds(setup.driveFolders)).toEqual([
      repaired.config.drive_folder_id,
    ]);
  });

  it("fails Workbench runtime if POC/demo wording or Gmail scopes appear", () => {
    expect(WORKBENCH_GOOGLE_CONNECTOR_SCOPES).toEqual([
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/calendar.readonly",
    ]);
    expect(WORKBENCH_GOOGLE_OAUTH_SCOPE).not.toMatch(/gmail/i);

    expect(
      findWorkbenchRuntimeMatches({
        "Gmail runtime scope":
          /\bgmail\b|googleapis\.com\/auth\/gmail|gmail\.(?:compose|modify|readonly|send)|\bdrafts\b/i,
        "POC/demo language":
          /\bpoc\b|proof\s+of\s+concept|\bdemo\b|\bdemonstration\b|sample\s+(?:app|data|response|workflow)|toy\s+\w+/i,
      }),
    ).toEqual([]);
  });

  it("guards prior-run save/read acceptance when the optional backend exists", async () => {
    const runHistoryPath = join(process.cwd(), "lib/workbench/run-history.ts");
    const listRoutePath = join(process.cwd(), "app/api/workbench/runs/route.ts");
    const getRoutePath = join(
      process.cwd(),
      "app/api/workbench/runs/[id]/route.ts",
    );

    if (
      !existsSync(runHistoryPath) ||
      !existsSync(listRoutePath) ||
      !existsSync(getRoutePath)
    ) {
      const smokeDoc = readFileSync(
        join(process.cwd(), "config/workbench-v1-smoke.md"),
        "utf8",
      );
      expect(smokeDoc).toContain("Prior run history pending");
      expect(smokeDoc).toContain("workbench_run_history");
      return;
    }

    const runHistory = (await import(
      /* @vite-ignore */ pathToFileURL(runHistoryPath).href
    )) as Partial<Record<string, unknown>>;

    expect(typeof runHistory.persistWorkbenchRun).toBe("function");
    expect(typeof runHistory.listWorkbenchRuns).toBe("function");
    expect(typeof runHistory.getWorkbenchRun).toBe("function");
  });
});

async function runConnectorSetup(setup: ReturnType<typeof createWorkbenchSetupHarness>) {
  const notion = await ensureWorkbenchNotionSetup({
    userId: setup.userId,
    config: setup.config,
    client: setup.notionClient,
    updateConfig: setup.updateConfig,
  });
  const drive = await ensureWorkbenchDriveSetup({
    userId: setup.userId,
    config: setup.config,
    accessToken: "google-token",
    fetch: setup.driveFetch,
    updateConfig: setup.updateConfig,
  });

  return {
    config: setup.config,
    notion,
    drive,
  };
}

function createWorkbenchSetupHarness() {
  const userId = "principal_staff_1";
  const config: SetupConfig = {
    user_id: userId,
    notion_parent_page_id: null,
    drive_folder_id: null,
    drive_folder_url: null,
  };
  const calls = {
    notion: [] as Array<
      | { operation: "listChildPages"; parentPageId: string }
      | { operation: "createPage"; title: string; parentPageId: string | null }
    >,
    drive: [] as Array<{ url: string; init: RequestInit }>,
  };
  const pages = new Map<string, NotionPage>();
  const driveFolders = new Map<string, DriveFolder>();
  let notionParentSequence = 0;
  let notionChildSequence = 0;
  let driveFolderSequence = 0;

  const updateConfig = async (update: SetupConfigUpdate) => {
    expect(update.userId).toBe(userId);
    if (update.notion_parent_page_id !== undefined) {
      config.notion_parent_page_id = update.notion_parent_page_id;
    }
    if (update.drive_folder_id !== undefined) {
      config.drive_folder_id = update.drive_folder_id;
    }
    if (update.drive_folder_url !== undefined) {
      config.drive_folder_url = update.drive_folder_url;
    }
  };

  const notionClient = {
    async listChildPages(parentPageId: string) {
      calls.notion.push({ operation: "listChildPages", parentPageId });
      const parent = pages.get(parentPageId);
      if (!parent || parent.deleted) {
        throw new Error(`Notion parent ${parentPageId} is inaccessible`);
      }
      return [...pages.values()]
        .filter((page) => page.parentPageId === parentPageId && !page.deleted)
        .map(({ id, title, url }) => ({ id, title, url }));
    },
    async createPage(input: WorkbenchNotionCreatePageInput) {
      calls.notion.push({
        operation: "createPage",
        title: input.title,
        parentPageId: input.parentPageId ?? null,
      });
      const isParent = !input.parentPageId;
      if (isParent) {
        notionParentSequence += 1;
      } else {
        notionChildSequence += 1;
      }
      const id = isParent
        ? `notion-parent-${notionParentSequence}`
        : `notion-child-${slug(input.title)}-${notionChildSequence}`;
      const page = {
        id,
        title: input.title,
        url: `https://notion.test/${id}`,
        parentPageId: input.parentPageId ?? null,
        deleted: false,
      };
      pages.set(id, page);
      return page;
    },
  } satisfies WorkbenchNotionSetupClient;

  const driveFetch = async (url: string | URL, init?: RequestInit) => {
    const requestUrl = String(url);
    const requestInit = init ?? {};
    calls.drive.push({ url: requestUrl, init: requestInit });

    if ((requestInit.method ?? "GET") === "POST") {
      driveFolderSequence += 1;
      const folder = {
        id: `drive-folder-${driveFolderSequence}`,
        url: `https://drive.google.com/drive/folders/drive-folder-${driveFolderSequence}`,
        deleted: false,
      };
      driveFolders.set(folder.id, folder);
      return jsonResponse({ id: folder.id, webViewLink: folder.url });
    }

    const folderId = decodeURIComponent(
      new URL(requestUrl).pathname.split("/").pop() ?? "",
    );
    const folder = driveFolders.get(folderId);
    if (!folder || folder.deleted) {
      return jsonResponse({ error: { code: 404 } }, 404);
    }

    return jsonResponse({
      id: folder.id,
      mimeType: "application/vnd.google-apps.folder",
      webViewLink: folder.url,
      capabilities: { canAddChildren: true },
    });
  };

  return {
    userId,
    config,
    calls,
    pages,
    driveFolders,
    updateConfig,
    notionClient,
    driveFetch,
    deleteNotionChild(parentPageId: string | null, title: string) {
      if (!parentPageId) return;
      const child = [...pages.values()].find(
        (page) =>
          page.parentPageId === parentPageId &&
          page.title === title &&
          !page.deleted,
      );
      if (child) child.deleted = true;
    },
    deleteDriveFolder(folderId: string | null) {
      if (!folderId) return;
      const folder = driveFolders.get(folderId);
      if (folder) folder.deleted = true;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function notionCreateCalls(
  calls: ReturnType<typeof createWorkbenchSetupHarness>["calls"]["notion"],
) {
  return calls.filter((call) => call.operation === "createPage");
}

function driveCreateCalls(
  calls: ReturnType<typeof createWorkbenchSetupHarness>["calls"]["drive"],
) {
  return calls.filter((call) => call.init.method === "POST");
}

function activeNotionChildTitles(
  pages: Map<string, NotionPage>,
  parentPageId: string | null,
): string[] {
  return [...pages.values()]
    .filter((page) => page.parentPageId === parentPageId && !page.deleted)
    .map((page) => page.title)
    .sort();
}

function activeDriveFolderIds(folders: Map<string, DriveFolder>): string[] {
  return [...folders.values()]
    .filter((folder) => !folder.deleted)
    .map((folder) => folder.id);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
