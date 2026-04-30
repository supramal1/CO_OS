import { describe, expect, it } from "vitest";
import {
  buildGoogleDriveMultipartUploadRequest,
  createGoogleDriveUploader,
} from "@/lib/workbench/save-back/google-drive";
import type { WorkbenchArtifact } from "@/lib/workbench/save-back";

const artifact: WorkbenchArtifact = {
  id: "artifact-1",
  name: "Launch Brief.txt",
  mimeType: "text/plain",
  content: "Launch brief content",
  metadata: { taskType: "doc_scaffold" },
};

describe("Workbench Google Drive uploader", () => {
  it("returns typed unavailable when the access token is missing", () => {
    expect(
      createGoogleDriveUploader({
        accessToken: null,
        driveFolderId: "folder-123",
        fetch: async () => {
          throw new Error("should not fetch");
        },
      }),
    ).toEqual({
      status: "unavailable",
      reason: "missing_access_token",
      folderId: "folder-123",
    });
  });

  it("returns typed unavailable when the Drive folder is missing", () => {
    expect(
      createGoogleDriveUploader({
        accessToken: "token-123",
        driveFolderId: "",
        fetch: async () => {
          throw new Error("should not fetch");
        },
      }),
    ).toEqual({
      status: "unavailable",
      reason: "missing_drive_folder",
      folderId: null,
    });
  });

  it("builds a typed multipart upload request for Drive v3", async () => {
    const request = buildGoogleDriveMultipartUploadRequest({
      artifact,
      folderId: "folder-123",
      accessToken: "token-123",
    });

    expect(request.url).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id%2CwebViewLink",
    );
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({
      Authorization: "Bearer token-123",
    });
    expect(request.init.headers["Content-Type"]).toMatch(/^multipart\/related; boundary=/);

    const body = await request.init.body.text();
    expect(body).toContain('"name":"Launch Brief.txt"');
    expect(body).toContain('"parents":["folder-123"]');
    expect(body).toContain("Content-Type: text/plain");
    expect(body).toContain("Launch brief content");
  });

  it("uploads through injected fetch and returns Drive file details", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const uploader = createGoogleDriveUploader({
      accessToken: "token-123",
      driveFolderId: "folder-123",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ id: "file-456", webViewLink: "https://drive.test/file-456" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    expect(uploader.status).toBe("available");
    if (uploader.status !== "available") throw new Error("expected available uploader");

    await expect(uploader.uploader({ artifact, folderId: uploader.folderId })).resolves.toEqual({
      fileId: "file-456",
      webUrl: "https://drive.test/file-456",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id%2CwebViewLink",
    );
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer token-123",
    });
  });
});
