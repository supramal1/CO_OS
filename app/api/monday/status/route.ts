import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMondayConnectionStatus } from "@/lib/monday/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const status = getMondayConnectionStatus({ userId: session.principalId });
  return NextResponse.json({ status });
}
