import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildProfileSnapshot } from "@/lib/profile/profile-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const profile = await buildProfileSnapshot({ session });
  return NextResponse.json(
    { profile },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
