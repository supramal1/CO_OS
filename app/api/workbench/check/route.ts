import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkbenchConnectorHealth } from "@/lib/workbench/connector-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const result = await getWorkbenchConnectorHealth({
    userId: session.principalId,
  });
  return NextResponse.json(result);
}
