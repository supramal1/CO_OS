export type MondaySuggestedActionSource =
  | "newsroom"
  | "workbench"
  | "project"
  | "review"
  | "deck";

export type MondaySuggestedActionType =
  | "post_update"
  | "change_status"
  | "create_item"
  | "attach_link";

export type MondaySuggestedActionStatus =
  | "suggested"
  | "posted"
  | "edited"
  | "dismissed"
  | "failed";

export type MondaySuggestedAction = {
  id: string;
  userId: string;
  source: MondaySuggestedActionSource;
  mondayItemId?: string;
  actionType: MondaySuggestedActionType;
  previewText?: string;
  payload: Record<string, unknown>;
  status: MondaySuggestedActionStatus;
  createdAt: string;
  updatedAt: string;
};

export type MondaySuggestedActionEvent = {
  runId?: unknown;
  title?: unknown;
  summary?: unknown;
  artifactUrl?: unknown;
  payload?: unknown;
};

export type CreateMondaySuggestedActionInput = {
  userId: string;
  source: MondaySuggestedActionSource;
  mondayItemId?: unknown;
  actionType?: MondaySuggestedActionType;
  event?: MondaySuggestedActionEvent;
};

export type MondayActionApprovalResult =
  | {
      status: "unavailable";
      reason: "monday_posting_client_not_connected";
      action: MondaySuggestedAction;
    }
  | {
      status: "not_found";
      action: null;
    };

export type MondayActionDismissalResult =
  | {
      status: "dismissed";
      action: MondaySuggestedAction;
    }
  | {
      status: "not_found";
      action: null;
    };

const suggestedActions = new Map<string, MondaySuggestedAction>();

export function createMondaySuggestedAction(
  input: CreateMondaySuggestedActionInput,
): MondaySuggestedAction {
  const now = new Date().toISOString();
  const event = input.event ?? {};
  const payload = buildSuggestedActionPayload(event);
  const mondayItemId = normalizeOptionalString(input.mondayItemId);
  const action: MondaySuggestedAction = {
    id: buildSuggestedActionId({
      source: input.source,
      runId: payload.runId,
      mondayItemId,
      title: payload.title,
    }),
    userId: input.userId,
    source: input.source,
    ...(mondayItemId ? { mondayItemId } : {}),
    actionType: input.actionType ?? "post_update",
    previewText: buildPreviewText(payload),
    payload,
    status: "suggested",
    createdAt: now,
    updatedAt: now,
  };

  suggestedActions.set(action.id, action);
  return action;
}

export function approveMondaySuggestedAction(input: {
  userId: string;
  actionId: string;
}): MondayActionApprovalResult {
  const action = getSuggestedActionForUser(input);
  if (!action) {
    return { status: "not_found", action: null };
  }

  const failedAction = updateSuggestedAction(action, "failed");
  return {
    status: "unavailable",
    reason: "monday_posting_client_not_connected",
    action: failedAction,
  };
}

export function dismissMondaySuggestedAction(input: {
  userId: string;
  actionId: string;
}): MondayActionDismissalResult {
  const action = getSuggestedActionForUser(input);
  if (!action) {
    return { status: "not_found", action: null };
  }

  return {
    status: "dismissed",
    action: updateSuggestedAction(action, "dismissed"),
  };
}

export function resetMondaySuggestedActionsForTests() {
  suggestedActions.clear();
}

export function isMondaySuggestedActionSource(
  value: unknown,
): value is MondaySuggestedActionSource {
  return (
    value === "newsroom" ||
    value === "workbench" ||
    value === "project" ||
    value === "review" ||
    value === "deck"
  );
}

export function isMondaySuggestedActionType(
  value: unknown,
): value is MondaySuggestedActionType {
  return (
    value === "post_update" ||
    value === "change_status" ||
    value === "create_item" ||
    value === "attach_link"
  );
}

function getSuggestedActionForUser(input: {
  userId: string;
  actionId: string;
}): MondaySuggestedAction | null {
  const action = suggestedActions.get(input.actionId);
  if (!action || action.userId !== input.userId) {
    return null;
  }
  return action;
}

function updateSuggestedAction(
  action: MondaySuggestedAction,
  status: MondaySuggestedActionStatus,
): MondaySuggestedAction {
  const updated = {
    ...action,
    status,
    updatedAt: new Date().toISOString(),
  };
  suggestedActions.set(updated.id, updated);
  return updated;
}

function buildSuggestedActionPayload(
  event: MondaySuggestedActionEvent,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const runId = normalizeOptionalString(event.runId);
  const title = normalizeOptionalString(event.title) ?? "CO OS update";
  const summary =
    normalizeOptionalString(event.summary) ?? "A CO OS work event is ready.";
  const artifactUrl = normalizeOptionalString(event.artifactUrl);

  if (artifactUrl) payload.artifactUrl = artifactUrl;
  if (runId) payload.runId = runId;
  payload.summary = summary;
  payload.title = title;

  const extraPayload = normalizeRecord(event.payload);
  if (extraPayload) {
    for (const [key, value] of Object.entries(extraPayload)) {
      if (!(key in payload)) {
        payload[key] = value;
      }
    }
  }

  return payload;
}

function buildPreviewText(payload: Record<string, unknown>): string {
  const title = normalizeOptionalString(payload.title) ?? "CO OS update";
  const summary =
    normalizeOptionalString(payload.summary) ?? "A CO OS work event is ready.";
  const artifactUrl = normalizeOptionalString(payload.artifactUrl);
  const linkText = artifactUrl ? ` Link: ${artifactUrl}` : "";
  return `${title}: ${summary}${linkText}`;
}

function buildSuggestedActionId(input: {
  source: MondaySuggestedActionSource;
  runId?: unknown;
  mondayItemId?: string;
  title?: unknown;
}): string {
  const source = slug(input.source);
  const sourceId =
    normalizeOptionalString(input.runId) ??
    input.mondayItemId ??
    normalizeOptionalString(input.title) ??
    "update";
  const item = input.mondayItemId ?? "unlinked";
  return `msa_${source}_${slug(sourceId)}_${slug(item)}`;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function slug(value: unknown): string {
  const normalized =
    normalizeOptionalString(value) ?? String(value ?? "unknown").trim();
  return (
    normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}
