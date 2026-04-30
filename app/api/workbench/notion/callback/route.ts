import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  exchangeWorkbenchNotionOAuthCode,
  verifyWorkbenchNotionOAuthState,
} from "@/lib/workbench/notion-oauth";
import { ensureWorkbenchNotionSetup } from "@/lib/workbench/notion-setup";
import { persistWorkbenchNotionOAuthToken } from "@/lib/workbench/notion-token-store";
import { getUserWorkbenchConfig } from "@/lib/workbench/retrieval/config";
import { patchWorkbenchUserConfig } from "@/lib/workbench/user-config";

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
        error: "workbench_notion_oauth_error",
        reason: "notion_oauth_provider_error",
      },
      { status: 400 },
    );
  }

  const state = verifyWorkbenchNotionOAuthState({
    state: url.searchParams.get("state"),
    principalId: session.principalId,
    sessionBinding: session.principalId,
  });

  if (state.status === "invalid") {
    const status =
      state.reason === "notion_oauth_state_secret_missing" ? 503 : 400;
    const error =
      status === 503
        ? "workbench_notion_oauth_unavailable"
        : "workbench_notion_oauth_error";
    return NextResponse.json({ error, reason: state.reason }, { status });
  }

  const exchanged = await exchangeWorkbenchNotionOAuthCode({
    code: url.searchParams.get("code"),
  });

  if (exchanged.status === "unavailable") {
    const status =
      exchanged.reason === "notion_oauth_code_missing" ? 400 : 503;
    const error =
      status === 503
        ? "workbench_notion_oauth_unavailable"
        : "workbench_notion_oauth_error";
    return NextResponse.json(
      { error, reason: exchanged.reason },
      { status },
    );
  }

  if (exchanged.status === "error") {
    return NextResponse.json(
      {
        error: "workbench_notion_oauth_error",
        reason: exchanged.reason,
        statusCode: exchanged.statusCode,
      },
      { status: 502 },
    );
  }

  const persisted = await persistWorkbenchNotionOAuthToken({
    principalId: session.principalId,
    token: exchanged.token,
  });

  if (persisted.status === "unavailable") {
    return NextResponse.json(
      {
        error: "workbench_notion_token_store_unavailable",
        reason: persisted.reason,
      },
      { status: 503 },
    );
  }

  if (persisted.status === "error") {
    return NextResponse.json(
      {
        error: "workbench_notion_token_store_error",
        reason: "notion_token_persistence_failed",
      },
      { status: 502 },
    );
  }

  const setup = await ensureWorkbenchNotionSetup({
    userId: session.principalId,
    config: await getUserWorkbenchConfig(session.principalId),
    token: exchanged.token.access_token ?? null,
    updateConfig: async (update) => {
      const result = await patchWorkbenchUserConfig(update.userId, {
        notion_parent_page_id: update.notion_parent_page_id,
      });
      if (result.status !== "ok") {
        throw new Error(workbenchConfigErrorMessage(result));
      }
    },
  });

  if (setup.status === "failed") {
    const redirectUrl = new URL("/profile", req.url);
    redirectUrl.searchParams.set("notion_setup", "failed");
    redirectUrl.searchParams.set("reason", setup.reason);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.redirect(new URL("/profile?notion_setup=connected", req.url));
}

function workbenchConfigErrorMessage(
  result: Exclude<
    Awaited<ReturnType<typeof patchWorkbenchUserConfig>>,
    { status: "ok" }
  >,
): string {
  if (result.status === "unavailable") return result.error;
  return result.detail;
}
