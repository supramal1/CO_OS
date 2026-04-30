import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { confirmMondayIdentity } from "@/lib/monday/identity";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const confirmation = await confirmMondayIdentity({
    userId: session.principalId,
    payload: await req.json(),
  });

  return NextResponse.json(
    { confirmation },
    { status: statusCodeForConfirmation(confirmation.status) },
  );
}

function statusCodeForConfirmation(status: string): number {
  if (status === "invalid") return 400;
  if (status === "unavailable") return 503;
  return 200;
}
