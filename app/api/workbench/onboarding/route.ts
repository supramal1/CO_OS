import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  runWorkbenchOnboardingAction,
  type WorkbenchOnboardingBody,
} from "@/lib/workbench/onboarding-action";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: WorkbenchOnboardingBody;
  try {
    body = (await req.json()) as WorkbenchOnboardingBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = await runWorkbenchOnboardingAction({
    userId: session.principalId,
    body,
  });
  return NextResponse.json(result.body, { status: result.status });
}
