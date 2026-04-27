import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CORNERSTONE_URL } from "@/lib/cornerstone";

// Governance proxy. Browser → /api/admin/* → Cornerstone /admin/*.
// Auth model: per-principal session.apiKey. Admin gating is enforced both
// here (session.isAdmin) and upstream (capability check on the API key).

export const dynamic = "force-dynamic";

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { path } = await params;
  const adminPath = `/admin/${path.join("/")}`;
  const qs = req.nextUrl.search;
  const fullPath = qs ? `${adminPath}${qs}` : adminPath;

  const init: RequestInit = {
    method: req.method,
    headers: {
      "X-API-Key": session.apiKey,
    },
    cache: "no-store",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.text();
    if (body) {
      init.body = body;
      init.headers = {
        ...init.headers,
        "Content-Type":
          req.headers.get("content-type") || "application/json",
      };
    }
  }

  try {
    const upstream = await fetch(`${CORNERSTONE_URL}${fullPath}`, init);
    const responseBody = await upstream.text();
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "proxy_request_failed";
    console.error("admin_proxy_error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
