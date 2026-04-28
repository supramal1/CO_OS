import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { cancelPendingApprovalsForTask } from "@/lib/workforce/approvals";
import { cancelTask } from "@/lib/workforce/runner";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.apiKey || !session.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const { id } = await params;
  const taskCancelled = cancelTask(id, session.principalId);
  const cancelledApprovals = await cancelPendingApprovalsForTask(
    id,
    session.principalId,
  );
  if (!taskCancelled && cancelledApprovals === 0) {
    return NextResponse.json({ error: "not_found_or_not_owner" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    taskId: id,
    state: "cancelled",
    cancelledApprovals,
    taskCancelled,
  });
}
