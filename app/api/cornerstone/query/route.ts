import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { CORNERSTONE_URL } from "@/lib/cornerstone";

export const dynamic = "force-dynamic";

type QueryBody = {
  query: string;
  threadId?: string | null;
  history?: { role: "user" | "assistant"; content: string }[];
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.apiKey) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: QueryBody;
  try {
    body = (await req.json()) as QueryBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.query?.trim()) {
    return NextResponse.json({ error: "missing_query" }, { status: 400 });
  }

  const payload = {
    query: body.query,
    namespace: "default",
    workspace_name: "default",
    history: body.history ?? [],
    recent_turns: [],
    thread_id: body.threadId ?? undefined,
    detail_level: "auto",
    source: "co-os",
    agent_id: "co-os-chat-v1",
  };

  const upstream = await fetch(`${CORNERSTONE_URL}/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": session.apiKey,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "(no body)");
    console.error("cornerstone_answer_error", upstream.status, text.slice(0, 300));
    return NextResponse.json(
      { error: "upstream_error", status: upstream.status },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
