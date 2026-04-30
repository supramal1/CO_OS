import type {
  WorkbenchApproachStep,
  WorkbenchDecodedTask,
  WorkbenchMissingContext,
  WorkbenchPreflightResult,
  WorkbenchRetrievedContext,
  WorkbenchTimeEstimate,
} from "./types";
import type { WorkbenchProfileContext } from "./profile";
import type {
  WorkbenchRetrievalSourceResult,
  WorkbenchRetrievalStatus,
} from "./retrieval/types";

export const WORKBENCH_PREFLIGHT_SKILL_NAME = "workbench-preflight";

export type BuildPreflightPromptInput = {
  ask: string;
  retrievedContext: WorkbenchRetrievedContext[];
  retrievalStatuses?: WorkbenchRetrievalStatus[];
  retrievalSources?: WorkbenchRetrievalSourceResult[];
  profileContext?: WorkbenchProfileContext | null;
};

export function buildPreflightPrompt(input: BuildPreflightPromptInput): string {
  const retrievedContext =
    input.retrievedContext.length > 0
      ? input.retrievedContext
      : [
          {
            claim:
              "No source-traced context was available for this run.",
            source_type: "placeholder" as const,
            source_label: "Workbench retrieval status",
            source_url: null,
          },
        ];

  return [
    "Run Workbench Pre-flight on the user's ask.",
    "",
    "Use the retrieved source-traced context below. If a claim has no source, do not assert it as retrieved context.",
    "",
    "Return only valid JSON with these exact top-level keys: decoded_task, missing_context, drafted_clarifying_message, retrieved_context, suggested_approach, time_estimate, warnings.",
    "Do not use em dashes.",
    "",
    "JSON shape:",
    JSON.stringify(
      {
        decoded_task: {
          summary: "string",
          requester: "string or null",
          deliverable_type: "string or null",
          task_type: "ask_decode",
        },
        missing_context: [{ question: "string", why: "string or null" }],
        drafted_clarifying_message: "string",
        retrieved_context: [
          {
            claim: "string",
            source_type: "notion | cornerstone | calendar | placeholder",
            source_label: "string",
            source_url: "string or null",
          },
        ],
        suggested_approach: [{ step: "string", rationale: "string or null" }],
        time_estimate: {
          estimated_before_minutes: 30,
          estimated_workbench_minutes: 10,
          task_type: "ask_decode",
        },
        warnings: ["string"],
      },
      null,
      2,
    ),
    "",
    "Retrieved context:",
    JSON.stringify(retrievedContext, null, 2),
    "",
    "Effective staff profile:",
    JSON.stringify(promptProfileContext(input.profileContext), null, 2),
    "",
    "Retrieval status:",
    retrievalStatusText(input),
    JSON.stringify(input.retrievalStatuses ?? [], null, 2),
    "",
    "User ask:",
    input.ask,
  ].join("\n");
}

function promptProfileContext(
  profile: WorkbenchProfileContext | null | undefined,
) {
  if (!profile) {
    return {
      summary_text: "No effective staff profile was available.",
      warnings: ["profile_context_missing"],
      source_refs: [],
    };
  }

  return {
    summary_text:
      profile.summary_text.trim() || "No effective staff profile was available.",
    role: profile.role,
    current_work: profile.current_work,
    communication_style: profile.communication_style,
    challenge_style: profile.challenge_style,
    working_context: profile.working_context,
    do_not_assume: profile.do_not_assume,
    warnings: profile.warnings,
    source_refs: profile.source_refs.map((ref) => ({
      source: ref.source,
      label: ref.label,
      page_title: ref.page_title ?? null,
      updated_at: ref.updated_at ?? null,
    })),
  };
}

function retrievalStatusText(input: BuildPreflightPromptInput): string {
  if (input.retrievalSources?.length) {
    return input.retrievalSources
      .map((source) => {
        const warnings = source.warnings.length
          ? ` (${source.warnings.join("; ")})`
          : "";
        return `${source.source}: ${source.status}${warnings}`;
      })
      .join("\n");
  }
  if (input.retrievalStatuses?.length) {
    return input.retrievalStatuses
      .map((status) => {
        const reason = status.reason ? ` (${status.reason})` : "";
        return `${status.source}: ${status.status}${reason}`;
      })
      .join("\n");
  }
  return "No retrieval status available.";
}

export function parseWorkbenchPreflightResult(
  raw: string,
): WorkbenchPreflightResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    throw new Error(
      `workbench_preflight_invalid_json: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return normalizePreflightResult(parsed);
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

function normalizePreflightResult(value: unknown): WorkbenchPreflightResult {
  const obj = asRecord(value);
  if (!obj) throw new Error("workbench_preflight_invalid_shape");

  return {
    decoded_task: normalizeDecodedTask(obj.decoded_task),
    missing_context: normalizeMissingContext(obj.missing_context),
    drafted_clarifying_message: asString(obj.drafted_clarifying_message),
    retrieved_context: normalizeRetrievedContext(obj.retrieved_context),
    suggested_approach: normalizeApproach(obj.suggested_approach),
    time_estimate: normalizeTimeEstimate(obj.time_estimate, obj.decoded_task),
    warnings: normalizeStringList(obj.warnings),
  };
}

function normalizeDecodedTask(value: unknown): WorkbenchDecodedTask {
  if (typeof value === "string") {
    return {
      summary: value,
      requester: null,
      deliverable_type: null,
      task_type: "ask_decode",
    };
  }
  const obj = asRecord(value);
  return {
    summary: asString(obj?.summary, "Task decoded."),
    requester: asNullableString(obj?.requester),
    deliverable_type: asNullableString(obj?.deliverable_type),
    task_type: asString(obj?.task_type, "ask_decode"),
  };
}

function normalizeMissingContext(value: unknown): WorkbenchMissingContext[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { question: item, why: null };
      const obj = asRecord(item);
      const question = asString(obj?.question);
      if (!question) return null;
      return { question, why: asNullableString(obj?.why) };
    })
    .filter((item): item is WorkbenchMissingContext => item !== null);
}

function normalizeRetrievedContext(value: unknown): WorkbenchRetrievedContext[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const obj = asRecord(item);
      const claim = asString(obj?.claim);
      const sourceLabel = asString(obj?.source_label);
      if (!claim || !sourceLabel) return null;
      return {
        claim,
        source_type: normalizeSourceType(obj?.source_type),
        source_label: sourceLabel,
        source_url: asNullableString(obj?.source_url),
      };
    })
    .filter((item): item is WorkbenchRetrievedContext => item !== null);
}

function normalizeApproach(value: unknown): WorkbenchApproachStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { step: item, rationale: null };
      const obj = asRecord(item);
      const step = asString(obj?.step);
      if (!step) return null;
      return { step, rationale: asNullableString(obj?.rationale) };
    })
    .filter((item): item is WorkbenchApproachStep => item !== null);
}

function normalizeTimeEstimate(
  value: unknown,
  decodedTask: unknown,
): WorkbenchTimeEstimate {
  const obj = asRecord(value);
  const decoded = asRecord(decodedTask);
  return {
    estimated_before_minutes: asNumber(obj?.estimated_before_minutes, 30),
    estimated_workbench_minutes:
      obj?.estimated_workbench_minutes == null
        ? null
        : asNumber(obj.estimated_workbench_minutes, 0),
    task_type: asString(obj?.task_type, asString(decoded?.task_type, "ask_decode")),
  };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

function normalizeSourceType(
  value: unknown,
): WorkbenchRetrievedContext["source_type"] {
  if (
    value === "notion" ||
    value === "cornerstone" ||
    value === "calendar" ||
    value === "placeholder"
  ) {
    return value;
  }
  return "placeholder";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}
