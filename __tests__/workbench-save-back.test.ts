import { describe, expect, it } from "vitest";
import { saveWorkbenchArtifactToDrive } from "@/lib/workbench/save-back";
import type { WorkbenchArtifact } from "@/lib/workbench/save-back";

const artifact: WorkbenchArtifact = {
  id: "artifact-1",
  name: "Launch Brief.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  content: new Uint8Array([1, 2, 3]),
  metadata: { taskType: "doc_scaffold" },
};

describe("Workbench Drive save-back", () => {
  it("returns typed unavailable when Drive folder config is missing", async () => {
    await expect(
      saveWorkbenchArtifactToDrive({
        artifact,
        driveFolderId: null,
        uploader: async () => {
          throw new Error("should not upload");
        },
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "missing_drive_folder",
      source: {
        provider: "google_drive",
        status: "unavailable",
        fileId: null,
        folderId: null,
        name: "Launch Brief.docx",
        mimeType: artifact.mimeType,
        webUrl: null,
      },
    });
  });

  it("returns typed unavailable when no uploader is injected", async () => {
    await expect(
      saveWorkbenchArtifactToDrive({
        artifact,
        driveFolderId: "folder-123",
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "missing_drive_uploader",
      source: {
        provider: "google_drive",
        status: "unavailable",
        folderId: "folder-123",
      },
    });
  });

  it("returns source-shaped Drive result from the injected uploader", async () => {
    const calls: Array<{ artifact: WorkbenchArtifact; folderId: string }> = [];

    await expect(
      saveWorkbenchArtifactToDrive({
        artifact,
        driveFolderId: "folder-123",
        uploader: async (input) => {
          calls.push(input);
          return {
            fileId: "file-456",
            webUrl: "https://drive.google.com/file/d/file-456/view",
          };
        },
      }),
    ).resolves.toEqual({
      status: "saved",
      source: {
        provider: "google_drive",
        status: "available",
        fileId: "file-456",
        folderId: "folder-123",
        name: "Launch Brief.docx",
        mimeType: artifact.mimeType,
        webUrl: "https://drive.google.com/file/d/file-456/view",
      },
    });

    expect(calls).toEqual([{ artifact, folderId: "folder-123" }]);
  });
});
