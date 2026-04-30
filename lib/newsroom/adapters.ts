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

  return calendarContextItemsToNewsroomSnapshot(result.items, context.range);
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
  range?: NewsroomAdapterContext["range"],
): NewsroomSourceSnapshot {
  const candidates = items.flatMap((item, index): NewsroomSourceSnapshot["candidates"] => {
    if (item.source_type !== "calendar") return [];
    if (!isCalendarItemInRange(item, range)) return [];

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
          signals: workbenchAttentionSignals(missingContext, warnings),
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
  context?: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  void context;

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
    const factCandidates = await loadCornerstoneFactCandidates(context);
    if (factCandidates.length > 0) {
      return snapshotFromCandidates(
        "cornerstone",
        summarizeCornerstoneFactCandidates(factCandidates),
      );
    }

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

    const text = cleanCornerstoneContextText(extractCornerstoneText(await res.text()));
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
          id: "cornerstone-context-0",
          title: "Recent Cornerstone context",
          reason: boundedText(firstSentence(text), WORKBENCH_REASON_MAX_LENGTH),
          source: "cornerstone",
          confidence: "medium",
          section: "changedSinceYesterday",
          signals: ["changed_since_yesterday"],
          sourceRefs: ["cornerstone:context"],
        },
      ],
    };
  } catch (error) {
    return errorSnapshot("cornerstone", errorReason(error));
  }
}

async function loadCornerstoneFactCandidates(
  context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot["candidates"]> {
  const res = await fetch(
    `${CORNERSTONE_URL.replace(/\/+$/, "")}/memory/facts?namespace=default&limit=25`,
    {
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": context.apiKey ?? "",
      },
      cache: "no-store",
    },
  );
  if (!res.ok) return [];

  const facts = factsFromCornerstonePayload(await res.json());
  return facts.flatMap((fact) => cornerstoneFactToCandidate(fact, context));
}

type CornerstoneFact = {
  key: string;
  value: string;
  updatedAt: string;
};

function factsFromCornerstonePayload(payload: unknown): CornerstoneFact[] {
  const record = recordValue(payload);
  const values =
    arrayValue(payload) ??
    arrayValue(record?.facts) ??
    arrayValue(record?.items) ??
    arrayValue(record?.data) ??
    [];

  return values.flatMap((value) => {
    const record = recordValue(value);
    const key = stringValue(record?.key);
    const factValue =
      stringValue(record?.value) ??
      stringValue(record?.content) ??
      stringValue(record?.text) ??
      stringValue(record?.summary);
    const updatedAt =
      stringValue(record?.updated_at) ??
      stringValue(record?.updatedAt) ??
      stringValue(record?.updated) ??
      stringValue(record?.created_at) ??
      stringValue(record?.createdAt);

    if (!key || !factValue || !updatedAt) return [];
    return [{ key, value: factValue, updatedAt }];
  });
}

function cornerstoneFactToCandidate(
  fact: CornerstoneFact,
  context: NewsroomAdapterContext,
): NewsroomSourceSnapshot["candidates"] {
  const updatedAt = Date.parse(fact.updatedAt);
  if (!Number.isFinite(updatedAt)) return [];
  if (updatedAt < context.range.since.getTime()) return [];
  if (updatedAt > context.now.getTime()) return [];

  const reason = boundedText(
    cleanCornerstoneContextText(fact.value),
    WORKBENCH_REASON_MAX_LENGTH,
  );
  if (!reason) return [];

  return [
    {
      id: `cornerstone-fact-${slugKey(fact.key)}`,
      title: boundedText(titleFromCornerstoneFactKey(fact.key), WORKBENCH_TITLE_MAX_LENGTH),
      reason,
      source: "cornerstone",
      confidence: "high",
      section: "changedSinceYesterday",
      signals: ["changed_since_yesterday"],
      sourceRefs: [`cornerstone:fact:${fact.key}`],
    },
  ];
}

function summarizeCornerstoneFactCandidates(
  candidates: NewsroomSourceSnapshot["candidates"],
): NewsroomSourceSnapshot["candidates"] {
  const summaries = candidates
    .slice(0, 5)
    .map((candidate) => candidate.title)
    .filter(Boolean);
  const reason =
    summaries.length > 0
      ? `Since yesterday: ${summaries.join("; ")}.`
      : "Source-backed Cornerstone changes were found since yesterday.";

  return [
    {
      id: "cornerstone-facts-summary",
      title: "CO OS changed since yesterday",
      reason: boundedText(reason, WORKBENCH_REASON_MAX_LENGTH),
      source: "cornerstone",
      confidence: "high",
      section: "changedSinceYesterday",
      signals: ["changed_since_yesterday"],
      sourceRefs: candidates.flatMap((candidate) => candidate.sourceRefs ?? []),
    },
  ];
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

function isCalendarItemInRange(
  item: WorkbenchRetrievedContext,
  range: NewsroomAdapterContext["range"] | undefined,
): boolean {
  if (!range) return true;

  const start = calendarItemStart(item);
  if (start === null) return true;

  return start >= range.from.getTime() && start < range.to.getTime();
}

function calendarItemStart(item: WorkbenchRetrievedContext): number | null {
  const record = recordValue(item);
  const metadataStart =
    stringValue(record?.start) ??
    stringValue(record?.start_at) ??
    stringValue(record?.start_time) ??
    stringValue(record?.event_start);
  const start = metadataStart ?? calendarClaimStart(stringValue(item.claim));
  if (!start) return null;

  const timestamp = Date.parse(start);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function calendarClaimStart(claim: string | null): string | null {
  if (!claim?.startsWith("Calendar event:")) return null;

  const candidate = claim.slice(claim.lastIndexOf(",") + 1).trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(candidate)) return null;
  return candidate;
}

function stripWorkingOnPrefix(value: string | null): string | null {
  if (!value) return null;
  const stripped = normalizeWhitespace(value.replace(/^Working On:\s*/i, ""));
  return stripped || null;
}

function workbenchAttentionSignals(
  missingContext: Array<{ question: string; why: string | null }>,
  warnings: string[],
): NewsroomSourceSnapshot["candidates"][number]["signals"] {
  const signals: NewsroomSourceSnapshot["candidates"][number]["signals"] = [];
  if (missingContext.length > 0) signals.push("missing_context");
  if (warnings.length > 0) signals.push("missing_evidence");
  signals.push("action_available");
  return signals;
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

function arrayValue(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
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

function cleanCornerstoneContextText(text: string): string {
  const lines = text
    .replace(/===\s*([^=]+?)\s*===/g, "\n=== $1 ===\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const kept: string[] = [];
  let inGraphMemory = false;

  for (const line of lines) {
    if (/^===\s*GRAPH MEMORY/i.test(line)) {
      inGraphMemory = true;
      continue;
    }
    if (/^===/.test(line)) {
      inGraphMemory = false;
      continue;
    }
    if (inGraphMemory) continue;
    if (/^\[IDENTITY\]/i.test(line)) continue;
    if (/\b(self_entity|user_name|pronoun_mapping|user_role|user_organization)\b/i.test(line)) {
      continue;
    }

    const cleaned = cleanCornerstoneMemoryLine(line);
    if (cleaned) kept.push(cleaned);
  }

  return normalizeWhitespace(kept.join(" "));
}

function cleanCornerstoneMemoryLine(line: string): string {
  const withoutMetadata = line
    .replace(/^-\s*\[[^\]]+\]\s*[^:]+:\s*/, "")
    .replace(/\s*\(updated:\s*[^)]+\)\s*$/i, "")
    .trim();

  if (!withoutMetadata || /^\[[^\]]+\]$/.test(withoutMetadata)) return "";
  return withoutMetadata;
}

function slugKey(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "fact"
  );
}

function titleFromCornerstoneFactKey(value: string): string {
  const words = value
    .replace(/^co[_-]+/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "Cornerstone fact";

  const title = words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index === 0) return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
      return lower;
    })
    .join(" ");

  return title || "Cornerstone fact";
}

function errorReason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Adapter failed.";
}
