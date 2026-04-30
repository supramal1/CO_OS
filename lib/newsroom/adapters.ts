import type { NewsroomAdapterContext, NewsroomSource, NewsroomSourceSnapshot } from "./types";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import { createGoogleCalendarClient } from "@/lib/workbench/google-calendar";
import { getWorkbenchGoogleAccessToken } from "@/lib/workbench/google-token";
import { createWorkbenchGoogleTokenStore } from "@/lib/workbench/google-token-store";
import { retrieveCalendarContext } from "@/lib/workbench/retrieval/calendar";
import { getUserWorkbenchConfig } from "@/lib/workbench/retrieval/config";
import { retrieveNotionContext } from "@/lib/workbench/retrieval/notion";
import { listWorkbenchRuns } from "@/lib/workbench/run-history";
import type { WorkbenchRetrievedContext } from "@/lib/workbench/types";

const WORKBENCH_TITLE_MAX_LENGTH = 96;
const WORKBENCH_REASON_MAX_LENGTH = 220;
const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export async function loadCalendarNewsroomSnapshot(
  context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  const config = await getUserWorkbenchConfig(context.userId);
  if (!(config?.google_oauth_scopes ?? []).includes(GOOGLE_CALENDAR_READONLY_SCOPE)) {
    return unavailableSnapshot("calendar", "calendar_scope_missing");
  }

  const token = await getWorkbenchGoogleAccessToken({
    principalId: context.userId,
    now: context.now,
    tokenStore: createWorkbenchGoogleTokenStore(),
  });
  if (token.status === "unavailable") {
    return unavailableSnapshot("calendar", token.reason);
  }
  if (token.status === "error") {
    return errorSnapshot("calendar", token.message);
  }

  const clientResult = createGoogleCalendarClient({ accessToken: token.accessToken });
  if (clientResult.status === "unavailable") {
    return unavailableSnapshot("calendar", clientResult.reason);
  }

  const result = await retrieveCalendarContext({
    ask: "Newsroom daily orientation: meetings today and prep needs",
    now: context.now,
    client: clientResult.client,
  });
  if (result.status.status === "unavailable") {
    return unavailableSnapshot("calendar", result.status.reason ?? "calendar_unavailable");
  }
  if (result.status.status === "error") {
    return errorSnapshot("calendar", result.status.reason ?? "calendar_error");
  }

  return calendarContextItemsToNewsroomSnapshot(result.items);
}

export async function loadNotionNewsroomSnapshot(
  context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  const config = await getUserWorkbenchConfig(context.userId);
  const result = await retrieveNotionContext({
    ask: "Newsroom daily orientation: Working On, active clients, active projects, profile context",
    userId: context.userId,
    config,
  });
  if (result.status.status === "unavailable") {
    return unavailableSnapshot("notion", result.status.reason ?? "notion_unavailable");
  }
  if (result.status.status === "error") {
    return errorSnapshot("notion", result.status.reason ?? "notion_error");
  }

  return notionContextItemsToNewsroomSnapshot(result.items);
}

export function calendarContextItemsToNewsroomSnapshot(
  items: WorkbenchRetrievedContext[],
): NewsroomSourceSnapshot {
  const candidates = items.flatMap((item, index): NewsroomSourceSnapshot["candidates"] => {
    if (item.source_type !== "calendar") return [];

    const title = boundedText(
      stringValue(item.source_label) ?? stringValue(item.claim) ?? "Calendar event",
      WORKBENCH_TITLE_MAX_LENGTH,
    );
    const reason = boundedText(
      stringValue(item.claim) ?? "Calendar context is available.",
      WORKBENCH_REASON_MAX_LENGTH,
    );
    const href = stringValue(item.source_url);

    return [
      {
        id: `calendar-context-${index}`,
        title,
        reason,
        source: "calendar",
        confidence: "medium",
        section: "today",
        ...(href
          ? {
              href,
              action: { label: "Open Calendar", target: "calendar" as const, href },
            }
          : {}),
        signals: href ? ["meeting_today", "action_available"] : ["meeting_today"],
        sourceRefs: [`calendar:${title}`],
      },
    ];
  });

  return snapshotFromCandidates("calendar", candidates);
}

export function notionContextItemsToNewsroomSnapshot(
  items: WorkbenchRetrievedContext[],
): NewsroomSourceSnapshot {
  const candidates = items.flatMap((item, index): NewsroomSourceSnapshot["candidates"] => {
    if (item.source_type !== "notion") return [];

    const claim = stringValue(item.claim);
    const sourceLabel = stringValue(item.source_label);
    const title = boundedText(
      stripWorkingOnPrefix(claim) ?? sourceLabel ?? "Notion context",
      WORKBENCH_TITLE_MAX_LENGTH,
    );
    const reason = boundedText(
      sourceLabel ?? claim ?? "Notion context is available.",
      WORKBENCH_REASON_MAX_LENGTH,
    );
    const href = stringValue(item.source_url);

    return [
      {
        id: `notion-context-${index}`,
        title,
        reason,
        source: "notion",
        confidence: "medium",
        section: "today",
        ...(href
          ? {
              href,
              action: { label: "Open Notion", target: "notion" as const, href },
            }
          : {}),
        signals: href ? ["active_work", "action_available"] : ["active_work"],
        sourceRefs: [`notion:${sourceLabel ?? title}`],
      },
    ];
  });

  return snapshotFromCandidates("notion", candidates);
}

export async function loadWorkbenchNewsroomSnapshot(
  context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  const result = await listWorkbenchRuns({ userId: context.userId, limit: 20 });
  if (result.status === "unavailable") {
    return unavailableSnapshot("workbench", result.error);
  }
  if (result.status === "error") {
    return errorSnapshot("workbench", result.detail);
  }

  const candidates = result.runs
    .filter((run) => isRunInNewsroomRange(run.created_at, context))
    .flatMap((run) => {
      const title = workbenchTitle(workbenchSummary(run.result), run.ask);
      const sourceRefs = [`workbench:${run.id}`];
      const action = { label: "Open Workbench", target: "workbench" as const, href: "/workbench" };
      const items: NewsroomSourceSnapshot["candidates"] = [
        {
          id: `workbench-run-${run.id}`,
          title,
          reason: "Workbench run started since yesterday.",
          source: "workbench",
          confidence: "medium",
          section: "changedSinceYesterday",
          href: "/workbench",
          action,
          signals: ["changed_since_yesterday", "action_available"],
          sourceRefs,
        },
      ];
      const missingContext = workbenchMissingContext(run.result);
      const warnings = workbenchWarnings(run.result);

      if (missingContext.length > 0 || warnings.length > 0) {
        items.push({
          id: `workbench-run-${run.id}-attention`,
          title: boundedText(`${title} needs attention`, WORKBENCH_TITLE_MAX_LENGTH),
          reason: attentionReason(missingContext, warnings),
          source: "workbench",
          confidence: "medium",
          section: "needsAttention",
          href: "/workbench",
          action,
          signals: ["missing_context", "missing_evidence", "action_available"],
          sourceRefs,
        });
      }

      return items;
    });

  return {
    source: "workbench",
    status: {
      source: "workbench",
      status: candidates.length > 0 ? "ok" : "empty",
      itemsCount: candidates.length,
    },
    candidates,
  };
}

export async function loadReviewNewsroomSnapshot(
  _context?: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return {
    source: "review",
    status: { source: "review", status: "empty", itemsCount: 0 },
    candidates: [],
  };
}

export async function loadCornerstoneNewsroomSnapshot(
  context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  if (!context.apiKey) {
    return unavailableSnapshot("cornerstone", "Missing Cornerstone API key.");
  }

  try {
    const res = await fetch(`${CORNERSTONE_URL.replace(/\/+$/, "")}/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": context.apiKey,
      },
      body: JSON.stringify({
        query:
          "Newsroom daily orientation: active projects, clients, recent decisions, and judgement needs.",
        namespace: "default",
        detail_level: "minimal",
        max_tokens: 600,
      }),
    });

    if (!res.ok) {
      return errorSnapshot("cornerstone", `Cornerstone returned ${res.status}.`);
    }

    const text = extractCornerstoneText(await res.text()).trim();
    if (!text) {
      return {
        source: "cornerstone",
        status: { source: "cornerstone", status: "empty", itemsCount: 0 },
        candidates: [],
      };
    }

    return {
      source: "cornerstone",
      status: { source: "cornerstone", status: "ok", itemsCount: 1 },
      candidates: [
        {
          id: "cornerstone-active-context",
          title: "Active context is available",
          reason: firstSentence(text),
          source: "cornerstone",
          confidence: "medium",
          section: "today",
          signals: ["active_work"],
          sourceRefs: ["cornerstone:context"],
        },
      ],
    };
  } catch (error) {
    return errorSnapshot("cornerstone", errorReason(error));
  }
}

function unavailableSnapshot(
  source: NewsroomSource,
  reason: string,
): NewsroomSourceSnapshot {
  return {
    source,
    status: {
      source,
      status: "unavailable",
      reason,
      itemsCount: 0,
    },
    candidates: [],
  };
}

function errorSnapshot(source: NewsroomSource, reason: string): NewsroomSourceSnapshot {
  return {
    source,
    status: {
      source,
      status: "error",
      reason,
      itemsCount: 0,
    },
    candidates: [],
  };
}

function snapshotFromCandidates(
  source: NewsroomSource,
  candidates: NewsroomSourceSnapshot["candidates"],
): NewsroomSourceSnapshot {
  return {
    source,
    status: {
      source,
      status: candidates.length > 0 ? "ok" : "empty",
      itemsCount: candidates.length,
    },
    candidates,
  };
}

function stripWorkingOnPrefix(value: string | null): string | null {
  if (!value) return null;
  return normalizeWhitespace(value.replace(/^Working On:\s*/i, ""));
}

function attentionReason(
  missingContext: Array<{ question: string; why: string | null }>,
  warnings: string[],
): string {
  const reasons = [
    missingContext.find((missing) => Boolean(normalizeWhitespace(missing.question)))?.question,
    warnings.find((warning) => Boolean(normalizeWhitespace(warning))),
  ];
  return boundedText(
    reasons.filter((reason): reason is string => Boolean(reason)).join(" ") ||
      "Workbench run needs attention.",
    WORKBENCH_REASON_MAX_LENGTH,
  );
}

function isRunInNewsroomRange(createdAt: string, context: NewsroomAdapterContext): boolean {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return false;

  return (
    timestamp >= context.range.since.getTime() &&
    timestamp < context.range.to.getTime() &&
    timestamp <= context.now.getTime()
  );
}

function workbenchTitle(summary: string | null, ask: unknown): string {
  return boundedText(summary || stringValue(ask) || "Workbench run", WORKBENCH_TITLE_MAX_LENGTH);
}

function workbenchSummary(result: unknown): string | null {
  const decodedTask = recordValue(recordValue(result)?.decoded_task);
  return stringValue(decodedTask?.summary);
}

function workbenchMissingContext(
  result: unknown,
): Array<{ question: string; why: string | null }> {
  const missingContext = recordValue(result)?.missing_context;
  if (!Array.isArray(missingContext)) return [];

  return missingContext.flatMap((item) => {
    const question = stringValue(recordValue(item)?.question);
    if (!question) return [];
    return [{ question, why: stringValue(recordValue(item)?.why) }];
  });
}

function workbenchWarnings(result: unknown): string[] {
  const warnings = recordValue(result)?.warnings;
  if (!Array.isArray(warnings)) return [];

  return warnings.flatMap((warning) => {
    const value = stringValue(warning);
    return value ? [value] : [];
  });
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? normalizeWhitespace(value) : null;
}

function boundedText(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractCornerstoneText(raw: string): string {
  if (!raw.trim()) return "";

  try {
    return textFromCornerstonePayload(JSON.parse(raw));
  } catch {
    return raw;
  }
}

function textFromCornerstonePayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";

  const record = payload as Record<string, unknown>;
  for (const key of ["context", "result", "answer", "content", "text"]) {
    const text = textFromCornerstonePayload(record[key]);
    if (text.trim()) return text;
  }
  return "";
}

function firstSentence(text: string): string {
  const match = text.trim().match(/^.+?[.!?](?:\s|$)/);
  return (match?.[0] ?? text).trim();
}

function errorReason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Adapter failed.";
}
