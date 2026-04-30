import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { createMondayAuthorizationUrl } from "@/lib/monday/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const result = createMondayAuthorizationUrl({
    origin: new URL(req.url).origin,
    principalId: session.principalId,
  });

  if (result.status === "unavailable") {
    return NextResponse.json(
      {
        error: "monday_oauth_unavailable",
        reason: result.reason,
        message:
          "monday OAuth is not configured. Add MONDAY_CLIENT_ID and MONDAY_CLIENT_SECRET before connecting users.",
      },
      { status: 503 },
    );
  }

  return NextResponse.redirect(result.url);
}
