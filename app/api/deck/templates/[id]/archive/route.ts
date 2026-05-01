import { NextResponse, type NextRequest } from "next/server";
import { requireDeckTemplateAdmin } from "@/lib/deck/template-route-utils";
import { archiveDeckTemplate } from "@/lib/deck/templates";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireDeckTemplateAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const template = await archiveDeckTemplate(guard.store, id);
  if (!template) {
    return NextResponse.json({ error: "deck_template_not_found" }, { status: 404 });
  }
  return NextResponse.json({ template });
}
