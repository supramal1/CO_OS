import { describe, expect, it } from "vitest";
import {
  archiveDeckTemplate,
  createDeckTemplate,
  listActiveDeckTemplates,
  setDefaultDeckTemplate,
  type DeckTemplateStore,
} from "@/lib/deck/templates";
import type { DeckTemplate, DeckTemplateCreateInput } from "@/lib/deck/template-types";

describe("deck template registry", () => {
  it("keeps only one active default template", async () => {
    const store = createDeckTemplateStoreDouble();
    const first = await createDeckTemplate(store, wppTemplateInput());
    const second = await createDeckTemplate(store, {
      name: "Generic CO Template",
      brand: "Charlie Oscar",
      client: null,
      use_case: "general",
      status: "active",
      source_pptx_path: null,
      google_slides_template_id: "slides-template-co",
      google_slides_template_url:
        "https://docs.google.com/presentation/d/slides-template-co/edit",
      is_default: false,
      layout_manifest: { roles: ["cover", "narrative"] },
    });

    await setDefaultDeckTemplate(store, second.id);

    const templates = await listActiveDeckTemplates(store);
    expect(templates.find((template) => template.id === first.id)?.is_default).toBe(false);
    expect(templates.find((template) => template.id === second.id)?.is_default).toBe(true);
  });

  it("does not list archived templates as active", async () => {
    const store = createDeckTemplateStoreDouble();
    const template = await createDeckTemplate(store, wppTemplateInput());

    await archiveDeckTemplate(store, template.id);

    expect(await listActiveDeckTemplates(store)).toEqual([]);
  });

  it("returns the active default template", async () => {
    const store = createDeckTemplateStoreDouble();
    const template = await createDeckTemplate(store, wppTemplateInput());

    await expect(
      import("@/lib/deck/templates").then(({ getDefaultDeckTemplate }) =>
        getDefaultDeckTemplate(store),
      ),
    ).resolves.toMatchObject({
      id: template.id,
      name: "WPP Media NEW Template - Google Version",
      is_default: true,
    });
  });
});

function wppTemplateInput(): DeckTemplateCreateInput {
  return {
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
    layout_manifest: {
      roles: [
        "cover",
        "agenda",
        "narrative",
        "evidence",
        "recommendation",
        "roadmap",
        "appendix",
      ],
    },
  };
}

function createDeckTemplateStoreDouble(): DeckTemplateStore {
  const rows = new Map<string, DeckTemplate>();
  let sequence = 0;

  return {
    async list() {
      return Array.from(rows.values()).sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async insert(input) {
      sequence += 1;
      const now = `2026-05-01T10:00:0${sequence}.000Z`;
      const row: DeckTemplate = {
        id: `template-${sequence}`,
        name: input.name,
        brand: input.brand,
        client: input.client,
        use_case: input.use_case,
        status: input.status,
        source_pptx_path: input.source_pptx_path,
        google_slides_template_id: input.google_slides_template_id,
        google_slides_template_url: input.google_slides_template_url,
        is_default: input.is_default,
        layout_manifest: input.layout_manifest,
        created_at: now,
        updated_at: now,
      };
      rows.set(row.id, row);
      return row;
    },
    async update(id, patch) {
      const existing = rows.get(id);
      if (!existing) return null;
      const updated = {
        ...existing,
        ...patch,
        updated_at: "2026-05-01T10:30:00.000Z",
      };
      rows.set(id, updated);
      return updated;
    },
    async unsetActiveDefaults(exceptId) {
      for (const row of rows.values()) {
        if (row.status === "active" && row.is_default && row.id !== exceptId) {
          rows.set(row.id, { ...row, is_default: false });
        }
      }
    },
  };
}
