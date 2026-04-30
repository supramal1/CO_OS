import { NextResponse } from "next/server";
import { generateNewsroomBrief } from "@/lib/newsroom/brief";
import { authWithApiKey } from "@/lib/server-auth";
import type { NewsroomBrief } from "@/lib/newsroom/types";

export const dynamic = "force-dynamic";

const NEWSROOM_ROUTE_CACHE_TTL_MS = 90 * 1000;

type NewsroomRouteCacheEntry = {
  expiresAt: number;
  brief: NewsroomBrief;
};

const newsroomRouteCache = new Map<string, NewsroomRouteCacheEntry>();

export async function GET() {
  const session = await authWithApiKey();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const cached = newsroomRouteCache.get(session.principalId);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(
      { brief: cached.brief },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Newsroom-Cache": "hit",
        },
      },
    );
  }

  const brief = await generateNewsroomBrief({
    userId: session.principalId,
    apiKey: session.apiKey,
  });
  newsroomRouteCache.set(session.principalId, {
    expiresAt: Date.now() + NEWSROOM_ROUTE_CACHE_TTL_MS,
    brief,
  });

  return NextResponse.json(
    { brief },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Newsroom-Cache": "miss",
      },
    },
  );
}
