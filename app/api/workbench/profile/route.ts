import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadWorkbenchProfileContext } from "@/lib/workbench/profile-loader";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const result = await loadWorkbenchProfileContext({
    userId: session.principalId,
  });

  return NextResponse.json(result);
}
