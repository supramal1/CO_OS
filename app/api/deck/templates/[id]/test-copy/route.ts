import { NextResponse, type NextRequest } from "next/server";
import { copyDeckGoogleSlidesTemplate } from "@/lib/deck/google-slides-template";
import { requireDeckTemplateAdmin } from "@/lib/deck/template-route-utils";
import { getDeckTemplate } from "@/lib/deck/templates";
import { getWorkbenchGoogleAccessToken } from "@/lib/workbench/google-token";
import { createWorkbenchGoogleTokenStore } from "@/lib/workbench/google-token-store";
import { getWorkbenchUserConfig } from "@/lib/workbench/user-config";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireDeckTemplateAdmin();
  if ("error" in guard) return guard.error;
  const principalId = guard.session.principalId;
  if (!principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  const template = await getDeckTemplate(guard.store, id);
  if (!template) {
    return NextResponse.json({ error: "deck_template_not_found" }, { status: 404 });
  }
  if (!template.google_slides_template_id) {
    return NextResponse.json(
      { error: "deck_template_google_slides_id_missing" },
      { status: 409 },
    );
  }

  const config = await getWorkbenchUserConfig(principalId);
  if (config.status !== "ok") {
    return NextResponse.json({ error: config.error }, { status: 503 });
  }

  const token = await getWorkbenchGoogleAccessToken({
    principalId,
    tokenStore: createWorkbenchGoogleTokenStore(),
  });
  if (token.status !== "available") {
    return NextResponse.json(
      {
        error:
          token.status === "unavailable"
            ? token.reason
            : token.reason,
      },
      { status: token.status === "unavailable" ? 409 : 502 },
    );
  }

  const copy = await copyDeckGoogleSlidesTemplate({
    accessToken: token.accessToken,
    templateFileId: template.google_slides_template_id,
    title: `${template.name} test copy`,
    folderId: config.config?.drive_folder_id ?? null,
  });

  return NextResponse.json({
    status: "copied",
    template_id: template.id,
    presentationId: copy.presentationId,
    webUrl: copy.webUrl,
    folderId: copy.folderId,
  });
}
