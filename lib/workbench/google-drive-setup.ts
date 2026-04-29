const WORKBENCH_DRIVE_FOLDER_NAME = "CO Workbench";
const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_FOLDER_FIELDS = "id,mimeType,webViewLink,capabilities(canAddChildren)";
const DRIVE_CREATE_FIELDS = "id,webViewLink";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type WorkbenchDriveSetupConfig = {
  drive_folder_id?: string | null;
  drive_folder_url?: string | null;
};

export type WorkbenchDriveSetupUpdate = {
  userId: string;
  drive_folder_id: string;
  drive_folder_url: string;
};

export type WorkbenchDriveSetupResult =
  | {
      status: "ready";
      reason:
        | "existing_valid"
        | "created"
        | "resource_missing"
        | "resource_inaccessible"
        | "target_not_folder"
        | "target_not_writable";
      repaired: boolean;
      drive_folder_id: string;
      drive_folder_url: string;
      updated: boolean;
    }
  | {
      status: "unavailable";
      reason: "missing_access_token";
      drive_folder_id: string | null;
      drive_folder_url: string | null;
      updated: false;
    };

type ExistingFolderValidation =
  | { status: "valid"; webViewLink: string | null }
  | {
      status: "invalid";
      reason:
        | "resource_missing"
        | "resource_inaccessible"
        | "target_not_folder"
        | "target_not_writable";
    };

type DriveFileResponse = {
  id?: unknown;
  mimeType?: unknown;
  webViewLink?: unknown;
  capabilities?: {
    canAddChildren?: unknown;
  };
};

export async function ensureWorkbenchDriveSetup(input: {
  userId: string;
  config: WorkbenchDriveSetupConfig | null | undefined;
  accessToken: string | null | undefined;
  updateConfig?: (update: WorkbenchDriveSetupUpdate) => Promise<void>;
  fetch?: FetchLike;
}): Promise<WorkbenchDriveSetupResult> {
  const existingFolderId = normalizeConfigValue(input.config?.drive_folder_id);
  const existingFolderUrl =
    normalizeConfigValue(input.config?.drive_folder_url) ??
    (existingFolderId ? driveFolderUrl(existingFolderId) : null);
  const accessToken = normalizeConfigValue(input.accessToken);

  if (!accessToken) {
    return {
      status: "unavailable",
      reason: "missing_access_token",
      drive_folder_id: existingFolderId,
      drive_folder_url: existingFolderUrl,
      updated: false,
    };
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("Workbench Google Drive setup requires fetch");
  }

  if (existingFolderId) {
    const validation = await validateDriveFolder({
      folderId: existingFolderId,
      accessToken,
      fetch: fetchImpl,
    });

    if (validation.status === "valid") {
      const resolvedUrl =
        existingFolderUrl ??
        validation.webViewLink ??
        driveFolderUrl(existingFolderId);
      const updated = await persistDriveFolderIfNeeded({
        updateConfig: input.updateConfig,
        userId: input.userId,
        folderId: existingFolderId,
        folderUrl: resolvedUrl,
        shouldUpdate: !normalizeConfigValue(input.config?.drive_folder_url),
      });

      return {
        status: "ready",
        reason: "existing_valid",
        repaired: false,
        drive_folder_id: existingFolderId,
        drive_folder_url: resolvedUrl,
        updated,
      };
    }

    return createAndPersistDriveFolder({
      userId: input.userId,
      accessToken,
      fetch: fetchImpl,
      updateConfig: input.updateConfig,
      reason: validation.reason,
      repaired: true,
    });
  }

  return createAndPersistDriveFolder({
    userId: input.userId,
    accessToken,
    fetch: fetchImpl,
    updateConfig: input.updateConfig,
    reason: "created",
    repaired: false,
  });
}

async function validateDriveFolder(input: {
  folderId: string;
  accessToken: string;
  fetch: FetchLike;
}): Promise<ExistingFolderValidation> {
  const response = await input.fetch(driveFileGetUrl(input.folderId), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return {
      status: "invalid",
      reason:
        response.status === 404 ? "resource_missing" : "resource_inaccessible",
    };
  }

  const body = (await response.json()) as DriveFileResponse;
  if (body.mimeType !== GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
    return { status: "invalid", reason: "target_not_folder" };
  }
  if (body.capabilities?.canAddChildren !== true) {
    return { status: "invalid", reason: "target_not_writable" };
  }

  return {
    status: "valid",
    webViewLink: typeof body.webViewLink === "string" ? body.webViewLink : null,
  };
}

async function createAndPersistDriveFolder(input: {
  userId: string;
  accessToken: string;
  fetch: FetchLike;
  updateConfig?: (update: WorkbenchDriveSetupUpdate) => Promise<void>;
  reason: Extract<WorkbenchDriveSetupResult, { status: "ready" }>["reason"];
  repaired: boolean;
}): Promise<WorkbenchDriveSetupResult> {
  const response = await input.fetch(driveFileCreateUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      name: WORKBENCH_DRIVE_FOLDER_NAME,
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Workbench Google Drive folder create failed: ${response.status}`,
    );
  }

  const body = (await response.json()) as DriveFileResponse;
  if (typeof body.id !== "string" || body.id.length === 0) {
    throw new Error("Workbench Google Drive folder create response missing id");
  }

  const folderUrl =
    typeof body.webViewLink === "string" && body.webViewLink.length > 0
      ? body.webViewLink
      : driveFolderUrl(body.id);
  const updated = await persistDriveFolderIfNeeded({
    updateConfig: input.updateConfig,
    userId: input.userId,
    folderId: body.id,
    folderUrl,
    shouldUpdate: true,
  });

  return {
    status: "ready",
    reason: input.reason,
    repaired: input.repaired,
    drive_folder_id: body.id,
    drive_folder_url: folderUrl,
    updated,
  };
}

async function persistDriveFolderIfNeeded(input: {
  updateConfig?: (update: WorkbenchDriveSetupUpdate) => Promise<void>;
  userId: string;
  folderId: string;
  folderUrl: string;
  shouldUpdate: boolean;
}): Promise<boolean> {
  if (!input.updateConfig || !input.shouldUpdate) return false;
  await input.updateConfig({
    userId: input.userId,
    drive_folder_id: input.folderId,
    drive_folder_url: input.folderUrl,
  });
  return true;
}

function driveFileGetUrl(folderId: string): string {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(folderId)}?fields=${encodeURIComponent(
    DRIVE_FOLDER_FIELDS,
  )}&supportsAllDrives=true`;
}

function driveFileCreateUrl(): string {
  return `${DRIVE_FILES_URL}?fields=${encodeURIComponent(
    DRIVE_CREATE_FIELDS,
  )}&supportsAllDrives=true`;
}

function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

function normalizeConfigValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
