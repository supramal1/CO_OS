import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { DeckTemplate } from "@/lib/deck/template-types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getDeckTemplateStore: vi.fn(),
  listActiveDeckTemplates: vi.fn(),
  listDeckTemplates: vi.fn(),
  createDeckTemplate: vi.fn(),
  updateDeckTemplate: vi.fn(),
  setDefaultDeckTemplate: vi.fn(),
  archiveDeckTemplate: vi.fn(),
  getDeckTemplate: vi.fn(),
  getWorkbenchUserConfig: vi.fn(),
  getWorkbenchGoogleAccessToken: vi.fn(),
  createWorkbenchGoogleTokenStore: vi.fn(),
  copyDeckGoogleSlidesTemplate: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  authWithApiKey: () => mocks.auth(),
}));

vi.mock("@/lib/deck/templates", () => ({
  getDeckTemplateStore: () => mocks.getDeckTemplateStore(),
  listActiveDeckTemplates: (...args: unknown[]) =>
    mocks.listActiveDeckTemplates(...args),
  listDeckTemplates: (...args: unknown[]) => mocks.listDeckTemplates(...args),
  createDeckTemplate: (...args: unknown[]) => mocks.createDeckTemplate(...args),
  updateDeckTemplate: (...args: unknown[]) => mocks.updateDeckTemplate(...args),
  setDefaultDeckTemplate: (...args: unknown[]) =>
    mocks.setDefaultDeckTemplate(...args),
  archiveDeckTemplate: (...args: unknown[]) =>
    mocks.archiveDeckTemplate(...args),
  getDeckTemplate: (...args: unknown[]) => mocks.getDeckTemplate(...args),
}));

vi.mock("@/lib/workbench/user-config", () => ({
  getWorkbenchUserConfig: (...args: unknown[]) =>
    mocks.getWorkbenchUserConfig(...args),
}));

vi.mock("@/lib/workbench/google-token", () => ({
  getWorkbenchGoogleAccessToken: (...args: unknown[]) =>
    mocks.getWorkbenchGoogleAccessToken(...args),
}));

vi.mock("@/lib/workbench/google-token-store", () => ({
  createWorkbenchGoogleTokenStore: () => mocks.createWorkbenchGoogleTokenStore(),
}));

vi.mock("@/lib/deck/google-slides-template", () => ({
  copyDeckGoogleSlidesTemplate: (...args: unknown[]) =>
    mocks.copyDeckGoogleSlidesTemplate(...args),
}));

import { GET, POST } from "@/app/api/deck/templates/route";
import { PATCH } from "@/app/api/deck/templates/[id]/route";
import { POST as ARCHIVE } from "@/app/api/deck/templates/[id]/archive/route";
import { POST as SET_DEFAULT } from "@/app/api/deck/templates/[id]/set-default/route";
import { POST as TEST_COPY } from "@/app/api/deck/templates/[id]/test-copy/route";

const template = {
  id: "tpl_wpp",
  name: "WPP Media NEW Template - Google Version",
  brand: "WPP Media",
  client: "WPP Media",
  use_case: "exec_summary",
  status: "active",
  source_pptx_path:
    "/Users/malik.james-williams/Desktop/WPP Media NEW Template - Google Version [COPY ONLY].pptx",
  google_slides_template_id: "slides-template-wpp",
  google_slides_template_url:
    "https://docs.google.com/presentation/d/slides-template-wpp/edit",
  is_default: true,
  layout_manifest: { roles: ["cover", "narrative"] },
  created_at: "2026-05-01T10:00:00.000Z",
  updated_at: "2026-05-01T10:00:00.000Z",
} satisfies DeckTemplate;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getDeckTemplateStore.mockReturnValue({ kind: "store" });
});

describe("GET /api/deck/templates", () => {
  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("lists active templates for staff users", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_1", isAdmin: false });
    mocks.listActiveDeckTemplates.mockResolvedValue([template]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ templates: [template] });
    expect(mocks.listActiveDeckTemplates).toHaveBeenCalledWith({ kind: "store" });
  });

  it("lists all templates for admin users", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_1", isAdmin: true });
    mocks.listDeckTemplates.mockResolvedValue([template]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ templates: [template] });
    expect(mocks.listDeckTemplates).toHaveBeenCalledWith({ kind: "store" });
  });
});

describe("POST /api/deck/templates", () => {
  it("blocks non-admin writes", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_1", isAdmin: false });

    const res = (await POST(jsonRequest({ name: "Blocked" }))) as Response;

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("creates a template for admins", async () => {
    mocks.auth.mockResolvedValue({ principalId: "admin_1", isAdmin: true });
    mocks.createDeckTemplate.mockResolvedValue(template);

    const res = (await POST(jsonRequest(template))) as Response;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ template });
    expect(mocks.createDeckTemplate).toHaveBeenCalledWith(
      { kind: "store" },
      expect.objectContaining({
        name: "WPP Media NEW Template - Google Version",
        google_slides_template_id: "slides-template-wpp",
      }),
    );
  });
});

describe("deck template item routes", () => {
  it("patches a template for admins", async () => {
    mocks.auth.mockResolvedValue({ principalId: "admin_1", isAdmin: true });
    mocks.updateDeckTemplate.mockResolvedValue({ ...template, use_case: "general" });

    const res = (await PATCH(jsonRequest({ use_case: "general" }), {
      params: Promise.resolve({ id: "tpl_wpp" }),
    })) as Response;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      template: { ...template, use_case: "general" },
    });
    expect(mocks.updateDeckTemplate).toHaveBeenCalledWith(
      { kind: "store" },
      "tpl_wpp",
      { use_case: "general" },
    );
  });

  it("sets the default template for admins", async () => {
    mocks.auth.mockResolvedValue({ principalId: "admin_1", isAdmin: true });
    mocks.setDefaultDeckTemplate.mockResolvedValue(template);

    const res = (await SET_DEFAULT(request(), {
      params: Promise.resolve({ id: "tpl_wpp" }),
    })) as Response;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ template });
    expect(mocks.setDefaultDeckTemplate).toHaveBeenCalledWith(
      { kind: "store" },
      "tpl_wpp",
    );
  });

  it("archives a template for admins", async () => {
    mocks.auth.mockResolvedValue({ principalId: "admin_1", isAdmin: true });
    mocks.archiveDeckTemplate.mockResolvedValue({
      ...template,
      status: "archived",
      is_default: false,
    });

    const res = (await ARCHIVE(request(), {
      params: Promise.resolve({ id: "tpl_wpp" }),
    })) as Response;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      template: { ...template, status: "archived", is_default: false },
    });
  });

  it("test-copies a Google Slides template for admins", async () => {
    mocks.auth.mockResolvedValue({ principalId: "admin_1", isAdmin: true });
    mocks.getDeckTemplate.mockResolvedValue(template);
    mocks.getWorkbenchUserConfig.mockResolvedValue({
      status: "ok",
      config: { drive_folder_id: "drive-folder-123" },
      google_readiness: { status: "ready" },
    });
    mocks.createWorkbenchGoogleTokenStore.mockReturnValue({ kind: "token-store" });
    mocks.getWorkbenchGoogleAccessToken.mockResolvedValue({
      status: "available",
      accessToken: "google-token",
      refreshed: false,
    });
    mocks.copyDeckGoogleSlidesTemplate.mockResolvedValue({
      presentationId: "copied-template-123",
      webUrl:
        "https://docs.google.com/presentation/d/copied-template-123/edit",
      folderId: "drive-folder-123",
    });

    const res = (await TEST_COPY(request(), {
      params: Promise.resolve({ id: "tpl_wpp" }),
    })) as Response;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "copied",
      template_id: "tpl_wpp",
      presentationId: "copied-template-123",
      webUrl:
        "https://docs.google.com/presentation/d/copied-template-123/edit",
      folderId: "drive-folder-123",
    });
    expect(mocks.copyDeckGoogleSlidesTemplate).toHaveBeenCalledWith({
      accessToken: "google-token",
      templateFileId: "slides-template-wpp",
      title: "WPP Media NEW Template - Google Version test copy",
      folderId: "drive-folder-123",
    });
  });
});

function request(url = "http://localhost/api/deck/templates"): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

function jsonRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
    url: "http://localhost/api/deck/templates",
    nextUrl: new URL("http://localhost/api/deck/templates"),
  } as unknown as NextRequest;
}
