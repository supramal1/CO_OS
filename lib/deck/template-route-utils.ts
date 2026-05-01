import { NextResponse, type NextRequest } from "next/server";
import { authWithApiKey as auth } from "@/lib/server-auth";
import { getDeckTemplateStore } from "@/lib/deck/templates";
import type { DeckTemplateCreateInput } from "@/lib/deck/template-types";

export async function requireDeckTemplateAdmin() {
  const session = await auth();
  if (!session?.principalId) {
    return {
      error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    } as const;
  }
  if (!session.isAdmin) {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    } as const;
  }
  const store = getDeckTemplateStore();
  if (!store) {
    return {
      error: NextResponse.json(
        { error: "deck_template_storage_unavailable" },
        { status: 503 },
      ),
    } as const;
  }
  return { session, store } as const;
}

export async function readDeckTemplateJson(
  req: NextRequest,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; error: NextResponse<{ error: string }> }
> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return {
      ok: false,
      error: NextResponse.json({ error: "invalid_json" }, { status: 400 }),
    };
  }
}

export function normalizeDeckTemplateCreateInput(
  value: unknown,
): DeckTemplateCreateInput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = readRequiredString(record.name);
  const useCase = readRequiredString(record.use_case);
  const status = readStatus(record.status);
  if (!name || !useCase || !status) return null;

  return {
    name,
    brand: readNullableString(record.brand),
    client: readNullableString(record.client),
    use_case: useCase,
    status,
    source_pptx_path: readNullableString(record.source_pptx_path),
    google_slides_template_id: readNullableString(
      record.google_slides_template_id,
    ),
    google_slides_template_url: readNullableString(
      record.google_slides_template_url,
    ),
    is_default: record.is_default === true,
    layout_manifest:
      record.layout_manifest &&
      typeof record.layout_manifest === "object" &&
      !Array.isArray(record.layout_manifest)
        ? (record.layout_manifest as DeckTemplateCreateInput["layout_manifest"])
        : {},
  };
}

export function normalizeDeckTemplatePartialInput(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const merged = {
    name: "placeholder",
    use_case: "general",
    status: "draft",
    ...(value as Record<string, unknown>),
  };
  const normalized = normalizeDeckTemplateCreateInput(merged);
  if (!normalized) return null;
  const patch: Partial<DeckTemplateCreateInput> = {};
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record) as Array<keyof DeckTemplateCreateInput>) {
    if (key in normalized) {
      patch[key] = normalized[key] as never;
    }
  }
  return patch;
}

function readRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStatus(value: unknown): DeckTemplateCreateInput["status"] | null {
  if (value === "draft" || value === "active" || value === "archived") {
    return value;
  }
  return null;
}
