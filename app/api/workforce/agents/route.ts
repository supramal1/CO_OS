import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listPublicAgents } from "@/lib/workforce/agent-info";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.apiKey) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  return NextResponse.json({ agents: listPublicAgents() });
}
