import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import { applyForgeNamespace } from "@/lib/forge-namespace";
import { isForgeTaskCancellable } from "@/lib/agents-cancel";
import type { ForgeTask } from "@/lib/agents-types";

export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json(
    detail ? { error, detail } : { error },
    { status },
  );
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey) {
    return jsonError(401, "unauthenticated");
  }
  if (!session.isAdmin) {
    return jsonError(403, "admin_only");
  }

  const taskUrl = new URL(`${CORNERSTONE_URL}/forge/tasks/${params.id}`);
  applyForgeNamespace(taskUrl, req);
  const taskRes = await fetch(taskUrl.toString(), {
    headers: { "X-API-Key": session.apiKey },
    cache: "no-store",
  });
  if (!taskRes.ok) {
    const text = await taskRes.text().catch(() => "");
    return jsonError(
      taskRes.status,
      "task_fetch_failed",
      text || `cornerstone-api returned ${taskRes.status}`,
    );
  }

  const task = (await taskRes.json()) as ForgeTask;
  if (!isForgeTaskCancellable(task)) {
    return jsonError(
      409,
      "task_not_cancellable",
      `Task is ${task.status}; only running tasks can be cancelled.`,
    );
  }

  const payload = JSON.stringify({ status: "cancelled", lane: "done" });
  const patchUrl = new URL(`${CORNERSTONE_URL}/forge/tasks/${params.id}`);
  applyForgeNamespace(patchUrl, req, payload);
  const upstream = await fetch(patchUrl.toString(), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": session.apiKey,
    },
    body: payload,
    cache: "no-store",
  });
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
