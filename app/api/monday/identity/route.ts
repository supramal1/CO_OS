import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveMondayIdentity } from "@/lib/monday/identity";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const identity = resolveMondayIdentity({
    userId: session.principalId,
    name: session.user?.name,
    email: session.user?.email,
  });

  return NextResponse.json({ identity });
}
