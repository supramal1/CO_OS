import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import { applyForgeNamespace } from "@/lib/forge-namespace";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const url = new URL(`${CORNERSTONE_URL}/forge/tasks`);
  applyForgeNamespace(url, req);
  const status = req.nextUrl.searchParams.get("status");
  if (status) url.searchParams.set("status", status);
  const agentId = req.nextUrl.searchParams.get("agent_id");
  if (agentId) url.searchParams.set("agent_id", agentId);
  const limit = req.nextUrl.searchParams.get("limit") ?? "100";
  url.searchParams.set("limit", limit);

  const upstream = await fetch(url.toString(), {
    headers: { "X-API-Key": session.apiKey },
    cache: "no-store",
  });
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const payload = await req.text();
  const url = new URL(`${CORNERSTONE_URL}/forge/tasks`);
  applyForgeNamespace(url, req, payload);
  const upstream = await fetch(url.toString(), {
    method: "POST",
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
