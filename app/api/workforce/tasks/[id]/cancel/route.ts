import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cancelTask } from "@/lib/workforce/runner";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey || !session.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const ok = cancelTask(params.id, session.principalId);
  if (!ok) {
    return NextResponse.json({ error: "not_found_or_not_owner" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, taskId: params.id, state: "cancelled" });
}
