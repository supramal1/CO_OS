import { NextResponse, type NextRequest } from "next/server";
import { authWithApiKey as auth } from "@/lib/server-auth";
import {
  createWorkbenchMakeAnthropicModelClient,
  generateWorkbenchArtifact,
} from "@/lib/workbench/make";
import type {
  WorkbenchPreflightResult,
  WorkbenchRetrievedContext,
} from "@/lib/workbench/types";

export const dynamic = "force-dynamic";

type MakeBody = {
  ask?: unknown;
  preflight_result?: unknown;
  retrieved_context?: unknown;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: MakeBody;
  try {
    body = (await req.json()) as MakeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const ask = typeof body.ask === "string" ? body.ask.trim() : "";
  if (!ask || !isRecord(body.preflight_result)) {
    return NextResponse.json(
      {
        error: "invalid_workbench_make_payload",
        required: ["ask", "preflight_result"],
      },
      { status: 400 },
    );
  }

  const result = await generateWorkbenchArtifact({
    ask,
    preflightResult: body.preflight_result as WorkbenchPreflightResult,
    retrievedContext: Array.isArray(body.retrieved_context)
      ? (body.retrieved_context as WorkbenchRetrievedContext[])
      : [],
    modelClient: createWorkbenchMakeAnthropicModelClient({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL,
    }),
  });

  return NextResponse.json(result, { status: statusCodeForMakeResult(result) });
}

function statusCodeForMakeResult(
  result: Awaited<ReturnType<typeof generateWorkbenchArtifact>>,
): number {
  if (result.status === "drafted") return 200;
  if (result.status === "unavailable") return 503;
  return 502;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
