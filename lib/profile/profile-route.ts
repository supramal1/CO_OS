import { NextResponse } from "next/server";
import { authWithApiKey, type ServerAuthSession } from "@/lib/server-auth";

export const PROFILE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

export async function withProfileSession<T>(
  buildPayload: (session: ServerAuthSession) => Promise<T> | T,
) {
  const session = await authWithApiKey();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const payload = await buildPayload(session);
  return NextResponse.json(payload, {
    headers: PROFILE_NO_STORE_HEADERS,
  });
}
