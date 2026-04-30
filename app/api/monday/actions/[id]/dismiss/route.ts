import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { dismissMondaySuggestedAction } from "@/lib/monday/suggested-actions";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await context.params;
  const result = dismissMondaySuggestedAction({
    userId: session.principalId,
    actionId: id,
  });

  if (result.status === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
