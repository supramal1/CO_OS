export type WorkbenchArtifact = {
  id: string;
  name: string;
  mimeType: string;
  content: Uint8Array | ArrayBuffer | string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export {
  buildGoogleDriveMultipartUploadRequest,
  createGoogleDriveUploader,
} from "./google-drive";
export type {
  GoogleDriveMultipartUploadRequest,
  GoogleDriveUploaderFactoryResult,
} from "./google-drive";

export type WorkbenchDriveSource = {
  provider: "google_drive";
  status: "available" | "unavailable";
  fileId: string | null;
  folderId: string | null;
  name: string;
  mimeType: string;
  webUrl: string | null;
};

export type WorkbenchDriveUploader = (input: {
  artifact: WorkbenchArtifact;
  folderId: string;
}) => Promise<{
  fileId: string;
  webUrl: string | null;
}>;

export type WorkbenchSaveBackResult =
  | {
      status: "saved";
      source: WorkbenchDriveSource & { status: "available"; fileId: string; folderId: string };
    }
  | {
      status: "unavailable";
      reason: "missing_drive_folder" | "missing_drive_uploader";
      source: WorkbenchDriveSource & { status: "unavailable" };
    };

export async function saveWorkbenchArtifactToDrive(input: {
  artifact: WorkbenchArtifact;
  driveFolderId?: string | null;
  uploader?: WorkbenchDriveUploader | null;
}): Promise<WorkbenchSaveBackResult> {
  const folderId = input.driveFolderId ?? null;

  if (!folderId) {
    return unavailableResult(input.artifact, null, "missing_drive_folder");
  }

  if (!input.uploader) {
    return unavailableResult(input.artifact, folderId, "missing_drive_uploader");
  }

  const uploaded = await input.uploader({
    artifact: input.artifact,
    folderId,
  });

  return {
    status: "saved",
    source: {
      provider: "google_drive",
      status: "available",
      fileId: uploaded.fileId,
      folderId,
      name: input.artifact.name,
      mimeType: input.artifact.mimeType,
      webUrl: uploaded.webUrl,
    },
  };
}

function unavailableResult(
  artifact: WorkbenchArtifact,
  folderId: string | null,
  reason: "missing_drive_folder" | "missing_drive_uploader",
): WorkbenchSaveBackResult {
  return {
    status: "unavailable",
    reason,
    source: {
      provider: "google_drive",
      status: "unavailable",
      fileId: null,
      folderId,
      name: artifact.name,
      mimeType: artifact.mimeType,
      webUrl: null,
    },
  };
}
