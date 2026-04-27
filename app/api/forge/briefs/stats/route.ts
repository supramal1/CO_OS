import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import { resolveForgeNamespace } from "@/lib/forge-namespace";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const namespace = await resolveForgeNamespace(
    session.apiKey,
    req.nextUrl.searchParams.get("namespace"),
  );
  if (!namespace.ok) {
    return NextResponse.json(
      { error: namespace.error },
      { status: namespace.status },
    );
  }
  const upstream = await fetch(
    `${CORNERSTONE_URL}/forge/briefs/stats?namespace=${encodeURIComponent(namespace.namespace)}`,
    {
      headers: { "X-API-Key": session.apiKey },
      cache: "no-store",
    },
  );
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
