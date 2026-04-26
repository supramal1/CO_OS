import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listRecentTasks, startTask } from "@/lib/workforce/runner";
import type { CreateTaskRequest } from "@/lib/workforce/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey || !session.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
  const tasks = await listRecentTasks(session.principalId, limit);
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey || !session.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    return NextResponse.json(
      { error: "anthropic_api_key_missing" },
      { status: 500 },
    );
  }

  let body: CreateTaskRequest;
  try {
    body = (await req.json()) as CreateTaskRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body?.agentId || typeof body.description !== "string" || !body.description.trim()) {
    return NextResponse.json(
      { error: "missing_fields", required: ["agentId", "description"] },
      { status: 400 },
    );
  }

  try {
    const outcome = startTask(body, {
      principalId: session.principalId,
      apiKey: session.apiKey,
      anthropicApiKey,
    });
    return NextResponse.json(
      {
        ...outcome,
        eventStreamUrl: `/api/workforce/tasks/${outcome.taskId}/events`,
        statusUrl: `/api/workforce/tasks/${outcome.taskId}`,
      },
      { status: 202 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
