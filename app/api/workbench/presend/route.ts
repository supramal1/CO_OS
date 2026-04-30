import { NextResponse, type NextRequest } from "next/server";
import { authWithApiKey as auth } from "@/lib/server-auth";
import { CookbookMcpError } from "@/lib/cookbook-client";
import { runWorkbenchPresend } from "@/lib/workbench/presend-start";

export const dynamic = "force-dynamic";

type PresendBody = {
  preflight_result?: unknown;
  draft_input?: unknown;
  artifact_spec_input?: unknown;
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

  let body: PresendBody;
  try {
    body = (await req.json()) as PresendBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const preflightResult = normalizeObject(body.preflight_result);
  const draftInput =
    typeof body.draft_input === "string" ? body.draft_input.trim() : "";
  const artifactSpecInput =
    typeof body.artifact_spec_input === "string"
      ? body.artifact_spec_input.trim()
      : "";

  if (!preflightResult || (!draftInput && !artifactSpecInput)) {
    return NextResponse.json(
      {
        error: "missing_presend_input",
        required: ["preflight_result", "draft_input or artifact_spec_input"],
      },
      { status: 400 },
    );
  }

  try {
    const result = await runWorkbenchPresend({
      preflightResult,
      draftInput,
      artifactSpecInput,
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
    const message = err instanceof Error ? err.message : String(err);
    console.error("workbench_presend_failed", message);
    return NextResponse.json(
      { error: "workbench_presend_failed", detail: message },
      { status: 502 },
    );
  }
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
