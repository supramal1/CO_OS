import type { NewsroomAdapterContext, NewsroomSource, NewsroomSourceSnapshot } from "./types";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import { listWorkbenchRuns } from "@/lib/workbench/run-history";

export async function loadCalendarNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return unavailableSnapshot("calendar", "Calendar adapter is not connected yet.");
}

export async function loadNotionNewsroomSnapshot(
  _context: NewsroomAdapterContext,
): Promise<NewsroomSourceSnapshot> {
  return unavailableSnapshot("notion", "Notion adapter is not connected yet.");
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
    .filter((run) => new Date(run.created_at).getTime() >= context.range.since.getTime())
    .flatMap((run) => {
      const title = run.result.decoded_task.summary || run.ask || "Workbench run";
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
      const missingContext = run.result.missing_context ?? [];
      const warnings = run.result.warnings ?? [];

      if (missingContext.length > 0 || warnings.length > 0) {
        items.push({
          id: `workbench-run-${run.id}-attention`,
          title: `${title} needs attention`,
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
  _context: NewsroomAdapterContext,
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

function attentionReason(
  missingContext: Array<{ question: string; why: string | null }>,
  warnings: string[],
): string {
  const reasons = [
    ...missingContext.map((missing) => missing.question).filter(Boolean),
    ...warnings.filter(Boolean),
  ];
  return reasons.join(" ") || "Workbench run needs attention.";
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
