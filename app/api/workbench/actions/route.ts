import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  buildCopyResponseOutcome,
  buildFeedbackOutcome,
  buildSaveToDriveOutcome,
  buildSaveToNotionOutcome,
  extractWorkbenchDriveSaveBack,
  isWorkbenchOutputAction,
  normalizeWorkbenchActionPayload,
  normalizeWorkbenchRunId,
  WORKBENCH_OUTPUT_ACTIONS,
  type WorkbenchOutputAction,
} from "@/lib/workbench/output-actions";
import { getWorkbenchSupabase } from "@/lib/workbench/supabase";

export const dynamic = "force-dynamic";

type WorkbenchActionBody = {
  action?: unknown;
  run_id?: unknown;
  payload?: unknown;
};

type FeedbackSupabase = {
  from(table: string): {
    insert(payload: WorkbenchOutputFeedbackPayload): PromiseLike<{
      error: { message?: string } | null;
    }>;
  };
};

type WorkbenchOutputFeedbackPayload = {
  user_id: string;
  run_id: string | null;
  action: "feedback_useful" | "feedback_not_useful";
  sentiment: "useful" | "not_useful";
  payload: Record<string, unknown> | null;
  created_at: string;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: WorkbenchActionBody;
  try {
    body = (await req.json()) as WorkbenchActionBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!isWorkbenchOutputAction(action)) {
    return NextResponse.json(
      { error: "invalid_action", valid_actions: [...WORKBENCH_OUTPUT_ACTIONS] },
      { status: 400 },
    );
  }

  const runId = normalizeWorkbenchRunId(body.run_id);
  const payload = normalizeWorkbenchActionPayload(body.payload);
  const result = await runWorkbenchOutputAction({
    action,
    runId,
    payload,
    userId: session.principalId,
  });

  return NextResponse.json(result);
}

async function runWorkbenchOutputAction(input: {
  action: WorkbenchOutputAction;
  runId?: string;
  payload?: Record<string, unknown>;
  userId: string;
}) {
  switch (input.action) {
    case "copy_response":
      return buildCopyResponseOutcome(input.runId);
    case "save_to_drive":
      return buildSaveToDriveOutcome({
        runId: input.runId,
        saveBack: extractWorkbenchDriveSaveBack(input.payload),
      });
    case "save_to_notion":
      return buildSaveToNotionOutcome(input.runId);
    case "feedback_useful":
    case "feedback_not_useful": {
      const persisted = await persistWorkbenchOutputFeedback({
        userId: input.userId,
        action: input.action,
        runId: input.runId,
        payload: input.payload,
      });
      return buildFeedbackOutcome({
        action: input.action,
        runId: input.runId,
        persisted,
      });
    }
  }
}

async function persistWorkbenchOutputFeedback(input: {
  userId: string;
  action: "feedback_useful" | "feedback_not_useful";
  runId?: string;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  const sb = getWorkbenchSupabase() as unknown as FeedbackSupabase | null;
  if (!sb) return false;

  const feedback: WorkbenchOutputFeedbackPayload = {
    user_id: input.userId,
    run_id: input.runId ?? null,
    action: input.action,
    sentiment: input.action === "feedback_useful" ? "useful" : "not_useful",
    payload: input.payload ?? null,
    created_at: new Date().toISOString(),
  };

  try {
    const { error } = await sb.from("workbench_output_feedback").insert(feedback);
    if (error) {
      console.warn(
        "[workbench] output feedback insert failed:",
        error.message ?? "unknown error",
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[workbench] output feedback insert threw:", String(err));
    return false;
  }
}
