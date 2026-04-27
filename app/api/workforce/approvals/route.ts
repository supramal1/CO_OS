// GET /api/workforce/approvals — list pending approvals for the current
// principal. Source of truth is the in-memory PENDING map in
// lib/workforce/approvals.ts; we return only entries owned by the caller
// so cross-principal visibility is impossible.
//
// Note: persisted history (resolved approvals) lives in tool_approvals on
// Supabase — see persistence.ts. This route deliberately does not surface
// that history; the inbox is for "what needs me right now?", not audit.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listPendingApprovals } from "@/lib/workforce/approvals";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey || !session.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const approvals = listPendingApprovals(session.principalId);
  return NextResponse.json({ approvals });
}
