import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeDeckTemplatePartialInput,
  readDeckTemplateJson,
  requireDeckTemplateAdmin,
} from "@/lib/deck/template-route-utils";
import { updateDeckTemplate } from "@/lib/deck/templates";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireDeckTemplateAdmin();
  if ("error" in guard) return guard.error;

  const body = await readDeckTemplateJson(req);
  if (!body.ok) return body.error;
  const patch = normalizeDeckTemplatePartialInput(body.value);
  if (!patch) {
    return NextResponse.json({ error: "invalid_template" }, { status: 400 });
  }

  const { id } = await params;
  const template = await updateDeckTemplate(guard.store, id, patch);
  if (!template) {
    return NextResponse.json({ error: "deck_template_not_found" }, { status: 404 });
  }
  return NextResponse.json({ template });
}
