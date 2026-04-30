import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  listWorkbenchRuns,
  normalizeWorkbenchRunLimit,
} from "@/lib/workbench/run-history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const result = await listWorkbenchRuns({
    userId: session.principalId,
    limit: parseLimit(req),
  });

  if (result.status === "unavailable") {
    return NextResponse.json(
      { error: result.error, runs: result.runs },
      { status: 503 },
    );
  }
  if (result.status === "error") {
    return NextResponse.json(
      { error: result.error, detail: result.detail, runs: result.runs },
      { status: 500 },
    );
  }

  return NextResponse.json({ runs: result.runs });
}

function parseLimit(req: NextRequest): number {
  const raw = req.nextUrl.searchParams.get("limit");
  if (!raw) return normalizeWorkbenchRunLimit(undefined);
  return normalizeWorkbenchRunLimit(Number.parseInt(raw, 10));
}
