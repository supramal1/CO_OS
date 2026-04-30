import { describe, expect, it } from "vitest";
import { ensureWorkbenchDriveSetup } from "@/lib/workbench/google-drive-setup";

type DriveCall = {
  url: string;
  init: RequestInit;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Workbench Google Drive setup", () => {
  it("creates one CO Workbench folder and stores the folder id and url on first setup", async () => {
    const calls: DriveCall[] = [];
    const updates: unknown[] = [];

    const result = await ensureWorkbenchDriveSetup({
      userId: "principal_123",
      config: { drive_folder_id: "", drive_folder_url: "" },
      accessToken: "access-token-123",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse({
          id: "folder-created-1",
          webViewLink: "https://drive.google.com/drive/folders/folder-created-1",
        });
      },
      updateConfig: async (update) => {
        updates.push(update);
      },
    });

    expect(result).toEqual({
      status: "ready",
      reason: "created",
      repaired: false,
      drive_folder_id: "folder-created-1",
      drive_folder_url: "https://drive.google.com/drive/folders/folder-created-1",
      updated: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://www.googleapis.com/drive/v3/files?fields=id%2CwebViewLink&supportsAllDrives=true",
    );
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer access-token-123",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      name: "CO Workbench",
      mimeType: "application/vnd.google-apps.folder",
    });
    expect(updates).toEqual([
      {
        userId: "principal_123",
        drive_folder_id: "folder-created-1",
        drive_folder_url: "https://drive.google.com/drive/folders/folder-created-1",
      },
    ]);
  });

  it("keeps a valid writable existing folder without creating a duplicate on re-auth", async () => {
    const calls: DriveCall[] = [];
    const updates: unknown[] = [];

    const result = await ensureWorkbenchDriveSetup({
      userId: "principal_123",
      config: {
        drive_folder_id: "folder-existing-1",
        drive_folder_url:
          "https://drive.google.com/drive/folders/folder-existing-1",
      },
      accessToken: "access-token-123",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse({
          id: "folder-existing-1",
          mimeType: "application/vnd.google-apps.folder",
          webViewLink: "https://drive.google.com/drive/folders/folder-existing-1",
          capabilities: { canAddChildren: true },
        });
      },
      updateConfig: async (update) => {
        updates.push(update);
      },
    });

    expect(result).toEqual({
      status: "ready",
      reason: "existing_valid",
      repaired: false,
      drive_folder_id: "folder-existing-1",
      drive_folder_url: "https://drive.google.com/drive/folders/folder-existing-1",
      updated: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://www.googleapis.com/drive/v3/files/folder-existing-1?fields=id%2CmimeType%2CwebViewLink%2Ccapabilities(canAddChildren)&supportsAllDrives=true",
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(updates).toEqual([]);
  });

  it("does not touch Drive after OAuth disconnect leaves no access token", async () => {
    const calls: DriveCall[] = [];
    const updates: unknown[] = [];

    const result = await ensureWorkbenchDriveSetup({
      userId: "principal_123",
      config: {
        drive_folder_id: "folder-existing-1",
        drive_folder_url:
          "https://drive.google.com/drive/folders/folder-existing-1",
      },
      accessToken: "",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse({});
      },
      updateConfig: async (update) => {
        updates.push(update);
      },
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "missing_access_token",
      drive_folder_id: "folder-existing-1",
      drive_folder_url: "https://drive.google.com/drive/folders/folder-existing-1",
      updated: false,
    });
    expect(calls).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("creates a replacement and reports resource_missing when the stored folder was deleted", async () => {
    const calls: DriveCall[] = [];
    const updates: unknown[] = [];

    const result = await ensureWorkbenchDriveSetup({
      userId: "principal_123",
      config: {
        drive_folder_id: "folder-deleted-1",
        drive_folder_url:
          "https://drive.google.com/drive/folders/folder-deleted-1",
      },
      accessToken: "access-token-123",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        if (String(url).includes("/folder-deleted-1?")) {
          return jsonResponse({ error: { code: 404 } }, 404);
        }
        return jsonResponse({
          id: "folder-replacement-1",
          webViewLink:
            "https://drive.google.com/drive/folders/folder-replacement-1",
        });
      },
      updateConfig: async (update) => {
        updates.push(update);
      },
    });

    expect(result).toEqual({
      status: "ready",
      reason: "resource_missing",
      repaired: true,
      drive_folder_id: "folder-replacement-1",
      drive_folder_url: "https://drive.google.com/drive/folders/folder-replacement-1",
      updated: true,
    });
    expect(calls.map((call) => call.init.method)).toEqual(["GET", "POST"]);
    expect(updates).toEqual([
      {
        userId: "principal_123",
        drive_folder_id: "folder-replacement-1",
        drive_folder_url:
          "https://drive.google.com/drive/folders/folder-replacement-1",
      },
    ]);
  });
});
