import { NextResponse, type NextRequest } from "next/server";
import { authWithApiKey as auth } from "@/lib/server-auth";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import { applyForgeNamespace } from "@/lib/forge-namespace";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function guard() {
  const session = await auth();
  if (!session?.apiKey) {
    return {
      error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    } as const;
  }
  if (!session.isAdmin) {
    return {
      error: NextResponse.json({ error: "admin_only" }, { status: 403 }),
    } as const;
  }
  return { apiKey: session.apiKey } as const;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const url = new URL(`${CORNERSTONE_URL}/forge/tasks/${id}`);
  applyForgeNamespace(url, req);
  const upstream = await fetch(url.toString(), {
    headers: { "X-API-Key": auth.apiKey },
    cache: "no-store",
  });
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  const payload = await req.text();
  const { id } = await params;
  const url = new URL(`${CORNERSTONE_URL}/forge/tasks/${id}`);
  applyForgeNamespace(url, req, payload);
  const upstream = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": auth.apiKey,
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
