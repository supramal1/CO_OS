import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  type WorkbenchResumeRequest,
  normalizeWorkbenchResumeAction,
  resumeWorkbenchRun,
} from "@/lib/workbench/resume";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
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

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = normalizeWorkbenchResumeAction(body.action);
  if (!action) {
    return NextResponse.json(
      { error: "invalid_workbench_resume_action" },
      { status: 400 },
    );
  }

  const result = await resumeWorkbenchRun({
    userId: session.principalId,
    runId,
    action,
    answers: body.answers as WorkbenchResumeRequest["answers"],
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
  if (result.status === "not_found") {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ resume: result.resume });
}
