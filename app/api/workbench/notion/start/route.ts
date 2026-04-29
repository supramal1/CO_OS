import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createWorkbenchNotionAuthorizationUrl } from "@/lib/workbench/notion-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const result = createWorkbenchNotionAuthorizationUrl({
    principalId: session.principalId,
    sessionBinding: session.apiKey ?? session.principalId,
  });

  if (result.status === "unavailable") {
    return NextResponse.json(
      {
        error: "workbench_notion_oauth_unavailable",
        reason: result.reason,
      },
      { status: 503 },
    );
  }

  return NextResponse.redirect(result.url);
}
