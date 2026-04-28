import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import { applyForgeNamespace } from "@/lib/forge-namespace";
import type { ForgeTask } from "@/lib/agents-types";
import type { Brief } from "@/lib/forge-types";
import {
  buildTaskPayloadFromBrief,
  linkedTaskIds,
} from "@/lib/forge-brief-promotion";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json(
    detail ? { error, detail } : { error },
    { status },
  );
}

async function upstreamText(res: Response): Promise<string> {
  return res.text().catch(() => "");
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey) {
    return jsonError(401, "unauthenticated");
  }
  if (!session.isAdmin) {
    return jsonError(403, "admin_only");
  }

  const bodyText = await req.text().catch(() => "");
  const { id } = await params;

  const briefUrl = new URL(`${CORNERSTONE_URL}/forge/briefs/${id}`);
  applyForgeNamespace(briefUrl, req, bodyText);
  const briefRes = await fetch(briefUrl.toString(), {
    headers: { "X-API-Key": session.apiKey },
    cache: "no-store",
  });
  if (!briefRes.ok) {
    return jsonError(
      briefRes.status,
      "brief_fetch_failed",
      (await upstreamText(briefRes)).slice(0, 500),
    );
  }
  const brief = (await briefRes.json()) as Brief;

  const existingTaskIds = linkedTaskIds(brief);
  if (existingTaskIds.length > 0) {
    return NextResponse.json(
      { error: "brief_already_promoted", task_ids: existingTaskIds },
      { status: 409 },
    );
  }

  const taskUrl = new URL(`${CORNERSTONE_URL}/forge/tasks`);
  applyForgeNamespace(taskUrl, req, bodyText);
  const taskRes = await fetch(taskUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": session.apiKey,
    },
    body: JSON.stringify(buildTaskPayloadFromBrief(brief)),
    cache: "no-store",
  });
  if (!taskRes.ok) {
    return jsonError(
      taskRes.status,
      "task_create_failed",
      (await upstreamText(taskRes)).slice(0, 500),
    );
  }
  const task = (await taskRes.json()) as ForgeTask;

  const patchRes = await fetch(briefUrl.toString(), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": session.apiKey,
    },
    body: JSON.stringify({
      status: "triaged",
      resulting_task_ids: [task.id],
    }),
    cache: "no-store",
  });
  if (!patchRes.ok) {
    return NextResponse.json(
      {
        error: "brief_link_failed",
        detail: (await upstreamText(patchRes)).slice(0, 500),
        task,
      },
      { status: 502 },
    );
  }

  const updatedBrief = (await patchRes.json()) as Brief;
  return NextResponse.json({ brief: updatedBrief, task }, { status: 201 });
}
