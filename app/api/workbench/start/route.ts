import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { CookbookMcpError } from "@/lib/cookbook-client";
import { runWorkbenchStart } from "@/lib/workbench/start";

export const dynamic = "force-dynamic";

type StartBody = {
  ask?: unknown;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.apiKey || !session.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    return NextResponse.json(
      { error: "anthropic_api_key_missing" },
      { status: 500 },
    );
  }

  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const ask = typeof body.ask === "string" ? body.ask.trim() : "";
  if (!ask) {
    return NextResponse.json(
      { error: "missing_ask", required: ["ask"] },
      { status: 400 },
    );
  }

  try {
    const result = await runWorkbenchStart({
      ask,
      userId: session.principalId,
      apiKey: session.apiKey,
      anthropicApiKey,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CookbookMcpError) {
      return NextResponse.json(
        { error: "cookbook_skill_load_failed", detail: err.message },
        { status: err.status || 502 },
      );
    }
    const classified = classifyWorkbenchStartError(err);
    if (classified) {
      console.error("workbench_start_failed", classified.error);
      return NextResponse.json(classified.body, { status: classified.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("workbench_start_failed", message);
    return NextResponse.json(
      { error: "workbench_start_failed", detail: message },
      { status: 502 },
    );
  }
}

function classifyWorkbenchStartError(err: unknown):
  | {
      status: number;
      error: string;
      body: {
        error: string;
        detail: string;
      };
    }
  | null {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : null;

  if (status === 401 || /invalid x-api-key|authentication_error/i.test(message)) {
    return {
      status: 401,
      error: "anthropic_api_key_rejected",
      body: {
        error: "anthropic_api_key_rejected",
        detail:
          "Anthropic rejected ANTHROPIC_API_KEY. Update the local key and restart the dev server.",
      },
    };
  }

  return null;
}
