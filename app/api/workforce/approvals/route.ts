// GET /api/workforce/approvals — list pending approvals for the current
// principal. Live approvals live in the in-memory PENDING map; cold-started
// processes first rehydrate pending tool_approvals rows as orphaned approvals
// so operators can clear the durable inbox.
//
// Note: persisted history (resolved approvals) lives in tool_approvals on
// Supabase — see persistence.ts. This route deliberately does not surface
// that history; the inbox is for "what needs me right now?", not audit.

import { NextResponse } from "next/server";
import { authWithApiKey as auth } from "@/lib/server-auth";
import { listPendingApprovals } from "@/lib/workforce/approvals";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.apiKey || !session.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const approvals = await listPendingApprovals(session.principalId);
  return NextResponse.json({ approvals });
}
