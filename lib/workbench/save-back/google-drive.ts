import type { WorkbenchArtifact, WorkbenchDriveUploader } from ".";

const DRIVE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id%2CwebViewLink";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GoogleDriveUploaderFactoryResult =
  | {
      status: "available";
      folderId: string;
      uploader: WorkbenchDriveUploader;
    }
  | {
      status: "unavailable";
      reason: "missing_access_token" | "missing_drive_folder";
      folderId: string | null;
    };

export type GoogleDriveMultipartUploadRequest = {
  url: string;
  init: RequestInit & {
    method: "POST";
    headers: Record<string, string>;
    body: Blob;
  };
};

export function createGoogleDriveUploader(input: {
  accessToken?: string | null;
  driveFolderId?: string | null;
  fetch?: FetchLike;
}): GoogleDriveUploaderFactoryResult {
  const folderId = normalizeConfigValue(input.driveFolderId);
  const accessToken = normalizeConfigValue(input.accessToken);

  if (!folderId) {
    return {
      status: "unavailable",
      reason: "missing_drive_folder",
      folderId: null,
    };
  }

  if (!accessToken) {
    return {
      status: "unavailable",
      reason: "missing_access_token",
      folderId,
    };
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("Google Drive uploader requires fetch");
  }

  return {
    status: "available",
    folderId,
    uploader: async ({ artifact, folderId: uploadFolderId }) => {
      const request = buildGoogleDriveMultipartUploadRequest({
        artifact,
        folderId: uploadFolderId,
        accessToken,
      });
      const response = await fetchImpl(request.url, request.init);

      if (!response.ok) {
        throw new Error(`Google Drive upload failed with status ${response.status}`);
      }

      const uploaded = (await response.json()) as { id?: unknown; webViewLink?: unknown };
      if (typeof uploaded.id !== "string" || uploaded.id.length === 0) {
        throw new Error("Google Drive upload response missing file id");
      }

      return {
        fileId: uploaded.id,
        webUrl: typeof uploaded.webViewLink === "string" ? uploaded.webViewLink : null,
      };
    },
  };
}

export function buildGoogleDriveMultipartUploadRequest(input: {
  artifact: WorkbenchArtifact;
  folderId: string;
  accessToken: string;
}): GoogleDriveMultipartUploadRequest {
  const boundary = `workbench_drive_${input.artifact.id}`;
  const metadata = {
    name: input.artifact.name,
    mimeType: input.artifact.mimeType,
    parents: [input.folderId],
  };

  const body = new Blob(
    [
      `--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata),
      "\r\n",
      `--${boundary}\r\n`,
      `Content-Type: ${input.artifact.mimeType}\r\n\r\n`,
      artifactContentAsBlobPart(input.artifact.content),
      "\r\n",
      `--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );

  return {
    url: DRIVE_UPLOAD_URL,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  };
}

function artifactContentAsBlobPart(content: WorkbenchArtifact["content"]): BlobPart {
  if (typeof content === "string") return content;
  if (content instanceof ArrayBuffer) return content;
  return content.slice().buffer as ArrayBuffer;
}

function normalizeConfigValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
