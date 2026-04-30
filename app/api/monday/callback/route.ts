import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { verifyMondayOAuthState } from "@/lib/monday/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  if (url.searchParams.has("error")) {
    return NextResponse.json(
      {
        error: "monday_oauth_error",
        reason: "monday_oauth_provider_error",
      },
      { status: 400 },
    );
  }

  const state = verifyMondayOAuthState({
    state: url.searchParams.get("state"),
    principalId: session.principalId,
  });

  if (state.status === "invalid") {
    const status =
      state.reason === "monday_oauth_state_secret_missing" ? 503 : 400;
    return NextResponse.json(
      {
        error:
          status === 503
            ? "monday_oauth_unavailable"
            : "monday_oauth_error",
        reason: state.reason,
      },
      { status },
    );
  }

  const code = url.searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json(
      {
        error: "monday_oauth_error",
        reason: "monday_oauth_code_missing",
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      status: "pending_token_persistence",
      message:
        "monday OAuth callback validated. Token exchange and encrypted persistence are intentionally not implemented in this foundation slice.",
    },
    { status: 202 },
  );
}
