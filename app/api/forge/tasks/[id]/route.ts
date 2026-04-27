import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import { resolveForgeNamespace } from "@/lib/forge-namespace";

export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

async function guard() {
  const session = await getServerSession(authOptions);
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

async function getNamespace(req: NextRequest, apiKey: string) {
  const namespace = await resolveForgeNamespace(
    apiKey,
    req.nextUrl.searchParams.get("namespace"),
  );
  if (!namespace.ok) {
    return {
      error: NextResponse.json(
        { error: namespace.error },
        { status: namespace.status },
      ),
    } as const;
  }
  return { namespace: namespace.namespace } as const;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  const resolved = await getNamespace(req, auth.apiKey);
  if ("error" in resolved) return resolved.error;
  const upstream = await fetch(
    `${CORNERSTONE_URL}/forge/tasks/${params.id}?namespace=${encodeURIComponent(resolved.namespace)}`,
    { headers: { "X-API-Key": auth.apiKey }, cache: "no-store" },
  );
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  const resolved = await getNamespace(req, auth.apiKey);
  if ("error" in resolved) return resolved.error;
  const payload = await req.text();
  const upstream = await fetch(
    `${CORNERSTONE_URL}/forge/tasks/${params.id}?namespace=${encodeURIComponent(resolved.namespace)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": auth.apiKey,
      },
      body: payload,
      cache: "no-store",
    },
  );
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  const resolved = await getNamespace(req, auth.apiKey);
  if ("error" in resolved) return resolved.error;
  const upstream = await fetch(
    `${CORNERSTONE_URL}/forge/tasks/${params.id}?namespace=${encodeURIComponent(resolved.namespace)}`,
    {
      method: "DELETE",
      headers: { "X-API-Key": auth.apiKey },
      cache: "no-store",
    },
  );
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
