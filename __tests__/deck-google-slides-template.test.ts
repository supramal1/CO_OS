import { describe, expect, it } from "vitest";
import {
  copyDeckGoogleSlidesTemplate,
  requireGoogleSlidesTemplateId,
} from "@/lib/deck/google-slides-template";

describe("Google Slides deck template copy", () => {
  it("rejects templates without a Google Slides template id", () => {
    expect(() => requireGoogleSlidesTemplateId(null)).toThrow(
      "deck_template_google_slides_id_missing",
    );
    expect(() => requireGoogleSlidesTemplateId("  ")).toThrow(
      "deck_template_google_slides_id_missing",
    );
  });

  it("copies a template into the Workbench Drive folder", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchDouble = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Response.json({
        id: "copied-presentation-123",
        webViewLink:
          "https://docs.google.com/presentation/d/copied-presentation-123/edit",
      });
    };

    const result = await copyDeckGoogleSlidesTemplate({
      accessToken: "google-token",
      templateFileId: "template-presentation-123",
      title: "WPP Media AI Ops Deck",
      folderId: "drive-folder-123",
      fetch: fetchDouble,
    });

    expect(result).toEqual({
      presentationId: "copied-presentation-123",
      webUrl:
        "https://docs.google.com/presentation/d/copied-presentation-123/edit",
      folderId: "drive-folder-123",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://www.googleapis.com/drive/v3/files/template-presentation-123/copy?supportsAllDrives=true&fields=id%2CwebViewLink",
    );
    expect(calls[0].init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer google-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "WPP Media AI Ops Deck",
        parents: ["drive-folder-123"],
      }),
    });
  });

  it("returns a deterministic Slides URL when Drive omits webViewLink", async () => {
    const result = await copyDeckGoogleSlidesTemplate({
      accessToken: "google-token",
      templateFileId: "template-presentation-123",
      title: "Untitled deck",
      fetch: async () => Response.json({ id: "copied-presentation-456" }),
    });

    expect(result.webUrl).toBe(
      "https://docs.google.com/presentation/d/copied-presentation-456/edit",
    );
    expect(result.folderId).toBeNull();
  });
});
