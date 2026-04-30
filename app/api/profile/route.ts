import { NextResponse } from "next/server";
import { authWithApiKey } from "@/lib/server-auth";
import { buildProfileSnapshot } from "@/lib/profile/profile-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await authWithApiKey();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const profile = await buildProfileSnapshot({
    session,
    apiKey: session.apiKey,
  });
  return NextResponse.json(
    { profile },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
