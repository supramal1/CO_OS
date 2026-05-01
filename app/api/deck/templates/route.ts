import { NextResponse, type NextRequest } from "next/server";
import { authWithApiKey as auth } from "@/lib/server-auth";
import {
  normalizeDeckTemplateCreateInput,
  readDeckTemplateJson,
  requireDeckTemplateAdmin,
} from "@/lib/deck/template-route-utils";
import {
  createDeckTemplate,
  getDeckTemplateStore,
  listActiveDeckTemplates,
  listDeckTemplates,
} from "@/lib/deck/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const store = getDeckTemplateStore();
  if (!store) {
    return NextResponse.json(
      { error: "deck_template_storage_unavailable", templates: [] },
      { status: 503 },
    );
  }

  const templates = session.isAdmin
    ? await listDeckTemplates(store)
    : await listActiveDeckTemplates(store);
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const guard = await requireDeckTemplateAdmin();
  if ("error" in guard) return guard.error;

  const body = await readDeckTemplateJson(req);
  if (!body.ok) return body.error;

  const input = normalizeDeckTemplateCreateInput(body.value);
  if (!input) {
    return NextResponse.json({ error: "invalid_template" }, { status: 400 });
  }

  const template = await createDeckTemplate(guard.store, input);
  return NextResponse.json({ template });
}
