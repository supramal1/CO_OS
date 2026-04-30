import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  createMondaySuggestedAction,
  isMondaySuggestedActionSource,
  isMondaySuggestedActionType,
} from "@/lib/monday/suggested-actions";

export const dynamic = "force-dynamic";

type SuggestUpdateBody = {
  source?: unknown;
  mondayItemId?: unknown;
  actionType?: unknown;
  event?: unknown;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: SuggestUpdateBody;
  try {
    body = (await req.json()) as SuggestUpdateBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isMondaySuggestedActionSource(body.source)) {
    return NextResponse.json(
      {
        error: "invalid_source",
        valid_sources: ["newsroom", "workbench", "project", "review", "deck"],
      },
      { status: 400 },
    );
  }

  if (
    body.actionType !== undefined &&
    !isMondaySuggestedActionType(body.actionType)
  ) {
    return NextResponse.json(
      {
        error: "invalid_action_type",
        valid_action_types: [
          "post_update",
          "change_status",
          "create_item",
          "attach_link",
        ],
      },
      { status: 400 },
    );
  }

  const action = createMondaySuggestedAction({
    userId: session.principalId,
    source: body.source,
    mondayItemId: body.mondayItemId,
    actionType: body.actionType,
    event: normalizeEvent(body.event),
  });

  return NextResponse.json({ action });
}

function normalizeEvent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value;
}
