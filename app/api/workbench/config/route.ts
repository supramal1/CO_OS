import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  getWorkbenchUserConfig,
  saveWorkbenchUserConfig,
  type WorkbenchConfigResult,
  type WorkbenchConfigValidationError,
  type WorkbenchUserConfigInput,
} from "@/lib/workbench/user-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const result = await getWorkbenchUserConfig(session.principalId);
  return workbenchConfigResponse(result);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: WorkbenchUserConfigInput;
  try {
    body = (await req.json()) as WorkbenchUserConfigInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = await saveWorkbenchUserConfig(session.principalId, body);
  return workbenchConfigResponse(result);
}

function workbenchConfigResponse(
  result: WorkbenchConfigResult | WorkbenchConfigValidationError,
) {
  if (!("status" in result)) {
    return NextResponse.json(
      { error: result.error, required: result.required },
      { status: 400 },
    );
  }

  if (result.status === "unavailable") {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  if (result.status === "error") {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: 502 },
    );
  }

  return NextResponse.json({
    config: result.config,
    google_readiness: result.google_readiness,
  });
}
