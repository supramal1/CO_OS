// POST /api/workforce/approvals/[id] — resolve a pending approval.
//
// Body: { approved: boolean, reason?: string }
//
// Auth: same admin gate as the rest of /api/workforce. Only the principal
// that owns the parent task can resolve — `resolveApproval` enforces this
// internally and returns 404 to other principals to avoid leaking
// existence.
//
// Idempotency: PENDING entries are deleted on resolve, so a duplicate
// click returns 404. The frontend should treat 404 on the second click as
// "already resolved" and refresh.

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { resolveApproval } from "@/lib/workforce/approvals";

export const dynamic = "force-dynamic";

interface ResolveBody {
  approved?: unknown;
  reason?: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.apiKey || !session.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }

  let body: ResolveBody;
  try {
    body = (await req.json()) as ResolveBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.approved !== "boolean") {
    return NextResponse.json(
      { error: "missing_fields", required: ["approved"] },
      { status: 400 },
    );
  }
  const reason = typeof body.reason === "string" ? body.reason : undefined;

  const { id } = await params;
  const ok = await resolveApproval(
    id,
    {
      approved: body.approved,
      reason,
      resolvedBy: session.principalId,
    },
    session.principalId,
  );
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
