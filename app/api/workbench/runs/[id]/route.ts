import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getWorkbenchRun } from "@/lib/workbench/run-history";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  const runId = typeof id === "string" ? id.trim() : "";
  if (!runId) {
    return NextResponse.json(
      { error: "missing_workbench_run_id" },
      { status: 400 },
    );
  }

  const result = await getWorkbenchRun({
    userId: session.principalId,
    id: runId,
  });

  if (result.status === "unavailable") {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  if (result.status === "error") {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: 500 },
    );
  }
  if (!result.run) {
    return NextResponse.json(
      { error: "workbench_run_not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ run: result.run });
}
