import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ensureWorkbenchDriveSetup } from "@/lib/workbench/google-drive-setup";
import {
  WORKBENCH_NOTION_KNOWLEDGE_PAGES,
  type WorkbenchNotionKnowledgePage,
} from "@/lib/workbench/notion";

type WorkbenchSetupConfig = {
  user_id: string;
  notion_parent_page_id: string | null;
  drive_folder_id: string | null;
  drive_folder_url: string | null;
};

type WorkbenchSetupConfigUpdate = {
  userId: string;
  notion_parent_page_id?: string;
  drive_folder_id?: string;
  drive_folder_url?: string;
};

type WorkbenchSetupNotionPage = {
  id: string;
  title: string;
  url: string | null;
};

type WorkbenchNotionSetupClient = {
  listChildPages(parentPageId: string): Promise<WorkbenchSetupNotionPage[]>;
  createPage(input: {
    title: string;
    parentPageId?: string | null;
  }): Promise<WorkbenchSetupNotionPage>;
};

type WorkbenchNotionSetupReport = {
  status: "created" | "validated" | "repaired" | "failed";
  parent_id: string | null;
  child_ids: Partial<Record<WorkbenchNotionKnowledgePage, string>>;
  counts: {
    created: number;
    validated: number;
    repaired: number;
  };
  reason?: string;
};

type WorkbenchNotionSetupContract = {
  WORKBENCH_NOTION_SETUP_CHILD_TITLES: readonly WorkbenchNotionKnowledgePage[];
  ensureWorkbenchNotionSetup(input: {
    userId: string;
    config: { notion_parent_page_id?: string | null } | null | undefined;
    client: WorkbenchNotionSetupClient | null;
    updateConfig?: (update: WorkbenchSetupConfigUpdate) => Promise<void>;
  }): Promise<WorkbenchNotionSetupReport>;
};

describe("Workbench connector setup stability gate", () => {
  it("reuses valid Notion and Drive resources after Google disconnect and reauth", async () => {
    const notionSetup = await loadNotionSetupContract();
    const setup = createWorkbenchSetupDouble();

    const first = await runConnectorSetup(setup, notionSetup);
    const firstNotionParentId = first.config.notion_parent_page_id;
    const firstDriveFolderId = first.config.drive_folder_id;

    setup.disconnectGoogle();
    setup.reauthorizeGoogle("google-token-after-reauth");

    const second = await runConnectorSetup(setup, notionSetup);

    expect(second.config.notion_parent_page_id).toBe(firstNotionParentId);
    expect(second.config.drive_folder_id).toBe(firstDriveFolderId);
    expect(notionCreateCalls(setup.calls.notion)).toHaveLength(6);
    expect(
      notionCreateCalls(setup.calls.notion)
        .filter((call) => call.parentPageId === firstNotionParentId)
        .map((call) => call.title),
    ).toEqual([...WORKBENCH_NOTION_KNOWLEDGE_PAGES]);
    expect(driveCreateCalls(setup.calls.drive)).toHaveLength(1);
    expect(second.notion).toMatchObject({
      status: "validated",
      parent_id: firstNotionParentId,
      counts: { created: 0, validated: 6, repaired: 0 },
    });
    expect(second.drive).toMatchObject({
      status: "ready",
      reason: "existing_valid",
      repaired: false,
      drive_folder_id: firstDriveFolderId,
      updated: false,
    });
  });

  it("repairs only a deleted Drive folder and reports the repair", async () => {
    const notionSetup = await loadNotionSetupContract();
    const setup = createWorkbenchSetupDouble();

    const first = await runConnectorSetup(setup, notionSetup);
    const firstNotionParentId = first.config.notion_parent_page_id;
    const firstDriveFolderId = first.config.drive_folder_id;
    setup.deleteDriveFolder(firstDriveFolderId);

    const repaired = await runConnectorSetup(setup, notionSetup);

    expect(repaired.config.notion_parent_page_id).toBe(firstNotionParentId);
    expect(repaired.config.drive_folder_id).not.toBe(firstDriveFolderId);
    expect(notionCreateCalls(setup.calls.notion)).toHaveLength(6);
    expect(driveCreateCalls(setup.calls.drive)).toHaveLength(2);
    expect(repaired.notion).toMatchObject({
      status: "validated",
      parent_id: firstNotionParentId,
      counts: { created: 0, validated: 6, repaired: 0 },
    });
    expect(repaired.drive).toMatchObject({
      status: "ready",
      reason: "resource_missing",
      repaired: true,
      drive_folder_id: repaired.config.drive_folder_id,
      updated: true,
    });
  });

  it("repairs only a deleted Notion child page and reports the repair", async () => {
    const notionSetup = await loadNotionSetupContract();
    const setup = createWorkbenchSetupDouble();

    const first = await runConnectorSetup(setup, notionSetup);
    const firstNotionParentId = first.config.notion_parent_page_id;
    const firstDriveFolderId = first.config.drive_folder_id;
    setup.deleteNotionChild(firstNotionParentId, "Voice");

    const repaired = await runConnectorSetup(setup, notionSetup);

    expect(repaired.config.notion_parent_page_id).toBe(firstNotionParentId);
    expect(repaired.config.drive_folder_id).toBe(firstDriveFolderId);
    expect(notionCreateCalls(setup.calls.notion)).toHaveLength(7);
    expect(
      notionCreateCalls(setup.calls.notion).filter((call) => call.title === "Voice"),
    ).toHaveLength(2);
    expect(driveCreateCalls(setup.calls.drive)).toHaveLength(1);
    expect(repaired.notion).toMatchObject({
      status: "repaired",
      parent_id: firstNotionParentId,
      counts: { created: 1, validated: 5, repaired: 1 },
    });
    expect(repaired.drive).toMatchObject({
      status: "ready",
      reason: "existing_valid",
      repaired: false,
      drive_folder_id: firstDriveFolderId,
    });
  });

  it("keeps Workbench runtime Gmail-free", () => {
    const matches = workbenchRuntimeFiles().flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [
        ...text.matchAll(
          /gmail|googleapis\.com\/auth\/gmail|gmail\.compose|drafts/gi,
        ),
      ].map((match) => `${relative(process.cwd(), file)}:${match[0]}`);
    });

    expect(matches).toEqual([]);
  });
});

async function runConnectorSetup(
  setup: ReturnType<typeof createWorkbenchSetupDouble>,
  notionSetup: WorkbenchNotionSetupContract,
) {
  const notion = await notionSetup.ensureWorkbenchNotionSetup({
    userId: setup.userId,
    config: setup.config,
    client: setup.notionClient,
    updateConfig: setup.updateConfig,
  });
  const drive = await ensureWorkbenchDriveSetup({
    userId: setup.userId,
    config: setup.config,
    accessToken: setup.googleAccessToken,
    fetch: setup.driveFetch,
    updateConfig: setup.updateConfig,
  });

  return {
    config: setup.config,
    notion,
    drive,
  };
}

async function loadNotionSetupContract(): Promise<WorkbenchNotionSetupContract> {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), "lib/workbench/notion-setup.ts"),
  ).href;

  try {
    const mod = (await import(
      /* @vite-ignore */ moduleUrl
    )) as Partial<WorkbenchNotionSetupContract>;
    if (
      typeof mod.ensureWorkbenchNotionSetup !== "function" ||
      !Array.isArray(mod.WORKBENCH_NOTION_SETUP_CHILD_TITLES)
    ) {
      throw new Error("notion setup exports missing");
    }
    expect(mod.WORKBENCH_NOTION_SETUP_CHILD_TITLES).toEqual([
      ...WORKBENCH_NOTION_KNOWLEDGE_PAGES,
    ]);
    return mod as WorkbenchNotionSetupContract;
  } catch (error) {
    throw new Error(
      [
        "Missing Workbench Notion setup contract.",
        "Expected lib/workbench/notion-setup.ts to export ensureWorkbenchNotionSetup(input), WORKBENCH_NOTION_SETUP_CHILD_TITLES, and the WorkbenchNotionSetupClient type.",
        "The setup service must use injected Notion dependencies, create the V1 parent plus five children once, reuse a valid stored parent after reauth, and repair only missing child pages.",
      ].join(" "),
      { cause: error },
    );
  }
}

function createWorkbenchSetupDouble() {
  const userId = "principal_staff_1";
  let googleAccessToken = "google-token-initial";
  let notionParentSequence = 0;
  let notionChildSequence = 0;
  let driveFolderSequence = 0;
  const config: WorkbenchSetupConfig = {
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
  const notionPages = new Map<
    string,
    WorkbenchSetupNotionPage & {
      parentPageId: string | null;
      deleted: boolean;
    }
  >();
  const driveFolders = new Map<
    string,
    { id: string; url: string; deleted: boolean }
  >();

  return {
    userId,
    config,
    calls,
    get googleAccessToken() {
      return googleAccessToken;
    },
    updateConfig: async (update: WorkbenchSetupConfigUpdate) => {
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
    },
    notionClient: {
      async listChildPages(parentPageId: string) {
        calls.notion.push({ operation: "listChildPages", parentPageId });
        const parent = notionPages.get(parentPageId);
        if (!parent || parent.deleted) {
          throw new Error(`Page ${parentPageId} is inaccessible`);
        }
        return [...notionPages.values()]
          .filter((page) => page.parentPageId === parentPageId && !page.deleted)
          .map(({ id, title, url }) => ({ id, title, url }));
      },
      async createPage(input: { title: string; parentPageId?: string | null }) {
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
        notionPages.set(id, page);
        return page;
      },
    } satisfies WorkbenchNotionSetupClient,
    driveFetch: async (url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      calls.drive.push({ url: requestUrl, init: init ?? {} });

      if ((init?.method ?? "GET") === "POST") {
        driveFolderSequence += 1;
        const id = `drive-folder-${driveFolderSequence}`;
        const folder = {
          id,
          url: `https://drive.google.com/drive/folders/${id}`,
          deleted: false,
        };
        driveFolders.set(id, folder);
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
    },
    disconnectGoogle() {
      googleAccessToken = "";
    },
    reauthorizeGoogle(accessToken: string) {
      googleAccessToken = accessToken;
    },
    deleteDriveFolder(folderId: string | null) {
      if (!folderId) return;
      const folder = driveFolders.get(folderId);
      if (folder) folder.deleted = true;
    },
    deleteNotionChild(
      parentPageId: string | null,
      title: WorkbenchNotionKnowledgePage,
    ) {
      if (!parentPageId) return;
      for (const page of notionPages.values()) {
        if (page.parentPageId === parentPageId && page.title === title) {
          page.deleted = true;
          return;
        }
      }
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
  calls: ReturnType<typeof createWorkbenchSetupDouble>["calls"]["notion"],
) {
  return calls.filter((call) => call.operation === "createPage");
}

function driveCreateCalls(
  calls: ReturnType<typeof createWorkbenchSetupDouble>["calls"]["drive"],
) {
  return calls.filter((call) => call.init.method === "POST");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function workbenchRuntimeFiles(): string[] {
  return ["lib/workbench", "app/api/workbench", "components/workbench"].flatMap(
    (dir) => listFiles(join(process.cwd(), dir)),
  );
}

function listFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path).flatMap((entry) => listFiles(join(path, entry)));
}
