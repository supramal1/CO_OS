import { NextResponse, type NextRequest } from "next/server";
import { authWithApiKey as auth } from "@/lib/server-auth";
import type { WorkbenchArtifact } from "@/lib/workbench/make";
import {
  createWorkbenchReviewAnthropicModelClient,
  reviewWorkbenchArtifact,
} from "@/lib/workbench/review";
import type { WorkbenchPreflightResult } from "@/lib/workbench/types";

export const dynamic = "force-dynamic";

type ReviewBody = {
  ask?: unknown;
  preflight_result?: unknown;
  artifact?: unknown;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: ReviewBody;
  try {
    body = (await req.json()) as ReviewBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const ask = typeof body.ask === "string" ? body.ask.trim() : "";
  if (!ask || !isRecord(body.preflight_result) || !isRecord(body.artifact)) {
    return NextResponse.json(
      {
        error: "invalid_workbench_review_payload",
        required: ["ask", "preflight_result", "artifact"],
      },
      { status: 400 },
    );
  }

  const result = await reviewWorkbenchArtifact({
    ask,
    preflightResult: body.preflight_result as WorkbenchPreflightResult,
    artifact: body.artifact as WorkbenchArtifact,
    modelClient: createWorkbenchReviewAnthropicModelClient({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL,
    }),
  });

  return NextResponse.json(result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
