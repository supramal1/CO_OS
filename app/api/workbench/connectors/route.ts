import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listWorkbenchConnectorManagementStatuses } from "@/lib/workbench/connector-management";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const connectors = await listWorkbenchConnectorManagementStatuses({
    userId: session.principalId,
  });
  return NextResponse.json({ connectors });
}
