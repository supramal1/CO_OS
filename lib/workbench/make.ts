import Anthropic from "@anthropic-ai/sdk";
import type {
  WorkbenchPreflightResult,
  WorkbenchRetrievedContext,
} from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_ASSUMPTIONS = 6;
const MAX_SOURCE_REFS = 8;

export type WorkbenchArtifactType =
  | "client_email"
  | "brief_outline"
  | "report_section"
  | "research_summary"
  | "action_plan"
  | "meeting_prep"
  | "options_recommendation"
  | "notion_doc";

export type WorkbenchArtifactSourceRef = {
  source_type: WorkbenchRetrievedContext["source_type"];
  source_label: string;
  source_url: string | null;
  claim: string;
};

export type WorkbenchArtifact = {
  type: WorkbenchArtifactType;
  title: string;
  body: string;
  assumptions: string[];
  source_refs: WorkbenchArtifactSourceRef[];
};

export type WorkbenchMakeModelClient = {
  create(input: {
    system: string;
    prompt: string;
    temperature: number;
    maxTokens: number;
  }): Promise<string>;
};

export type WorkbenchMakeResult =
  | {
      status: "drafted";
      artifact: WorkbenchArtifact;
    }
  | {
      status: "unavailable";
      reason: "workbench_make_model_unavailable";
      message: string;
    }
  | {
      status: "error";
      reason:
        | "anthropic_api_key_rejected"
        | "workbench_make_failed"
        | "workbench_make_invalid_json";
      message: string;
    };

export async function generateWorkbenchArtifact(input: {
  ask: string;
  preflightResult: WorkbenchPreflightResult;
  retrievedContext: WorkbenchRetrievedContext[];
  modelClient: WorkbenchMakeModelClient | null;
}): Promise<WorkbenchMakeResult> {
  if (!input.modelClient) {
    return {
      status: "unavailable",
      reason: "workbench_make_model_unavailable",
      message: "Workbench cannot generate a draft right now.",
    };
  }

  let raw: string;
  try {
    raw = await input.modelClient.create({
      system: [
        "You are the Workbench Make stage.",
        "Create a useful first working artefact for a staff member.",
        "Scaffold the work, do not overclaim.",
        "Use source_refs only for retrieved context that supports the output.",
        "Return only strict JSON with an artifact object.",
        "Do not use em dashes.",
      ].join(" "),
      prompt: buildWorkbenchMakePrompt(input),
      temperature: 0.2,
      maxTokens: 1800,
    });
  } catch (error) {
    if (isAnthropicAuthError(error)) {
      return {
        status: "error",
        reason: "anthropic_api_key_rejected",
        message:
          "Anthropic rejected ANTHROPIC_API_KEY. Update the local key and restart the dev server.",
      };
    }
    console.warn("[workbench] make model failed; using deterministic draft.");
    return { status: "drafted", artifact: buildDeterministicArtifact(input) };
  }

  const artifact = parseWorkbenchArtifact(raw, input.preflightResult);
  if (!artifact) {
    console.warn("[workbench] make model returned invalid JSON; using deterministic draft.");
    return { status: "drafted", artifact: buildDeterministicArtifact(input) };
  }

  return { status: "drafted", artifact };
}

function isAnthropicAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;
  return status === 401 || /invalid x-api-key|authentication_error/i.test(message);
}

export function createWorkbenchMakeAnthropicModelClient(input: {
  apiKey?: string | null;
  model?: string | null;
}): WorkbenchMakeModelClient | null {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  const model = input.model?.trim() || DEFAULT_MODEL;

  return {
    async create(request) {
      const response = await client.messages.create({
        model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
      });
      return response.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
    },
  };
}

export function inferWorkbenchArtifactType(
  preflightResult: WorkbenchPreflightResult,
): WorkbenchArtifactType {
  const decoded = preflightResult.decoded_task;
  const text = [
    decoded.summary,
    decoded.deliverable_type,
    decoded.task_type,
    ...preflightResult.suggested_approach.map((step) => step.step),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(options?|recommendation|recommend)\b/.test(text)) {
    return "options_recommendation";
  }
  if (/\b(?:meeting|prep|agenda|check-in|check in)\b/.test(text)) {
    return "meeting_prep";
  }
  if (/\b(email|reply|response|follow-up|follow up)\b/.test(text)) {
    return "client_email";
  }
  if (/\b(?:brief|outline)\b/.test(text)) return "brief_outline";
  if (/\b(?:report|section)\b/.test(text)) return "report_section";
  if (/\b(?:research|summary|summarise|summarize)\b/.test(text)) {
    return "research_summary";
  }
  if (/\b(action plan|plan|next steps|todo)\b/.test(text)) return "action_plan";
  return "notion_doc";
}

function buildWorkbenchMakePrompt(input: {
  ask: string;
  preflightResult: WorkbenchPreflightResult;
  retrievedContext: WorkbenchRetrievedContext[];
}): string {
  return [
    "Generate the Make-stage artefact for this Workbench run.",
    "",
    `User ask: ${input.ask}`,
    "",
    "Preflight result:",
    JSON.stringify(input.preflightResult, null, 2),
    "",
    "Retrieved context:",
    JSON.stringify(input.retrievedContext, null, 2),
    "",
    "Return JSON exactly shaped as:",
    JSON.stringify(
      {
        artifact: {
          type: inferWorkbenchArtifactType(input.preflightResult),
          title: "string",
          body: "string",
          assumptions: ["string"],
          source_refs: [
            {
              source_type: "notion | cornerstone | calendar | placeholder",
              source_label: "string",
              source_url: "string or null",
              claim: "string",
            },
          ],
        },
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildDeterministicArtifact(input: {
  ask: string;
  preflightResult: WorkbenchPreflightResult;
  retrievedContext: WorkbenchRetrievedContext[];
}): WorkbenchArtifact {
  const preflight = input.preflightResult;
  const decoded = preflight.decoded_task;
  const artifactType = inferWorkbenchArtifactType(preflight);
  const title =
    normalizeString(decoded.deliverable_type) ||
    normalizeString(decoded.summary) ||
    "Workbench draft";
  const sourceRefs = contextToSourceRefs([
    ...input.retrievedContext,
    ...preflight.retrieved_context,
  ]);
  const approach = preflight.suggested_approach
    .map((step) => normalizeString(step.step))
    .filter(Boolean);
  const missingContext = preflight.missing_context
    .map((item) => normalizeString(item.question))
    .filter(Boolean);
  const lines = [
    `Draft for: ${normalizeString(input.ask) || normalizeString(decoded.summary) || "the task"}`,
    "",
    normalizeString(decoded.summary),
    "",
    approach.length > 0 ? "Suggested structure:" : "",
    ...approach.map((step) => `- ${step}`),
    "",
    sourceRefs.length > 0 ? "Context used:" : "",
    ...sourceRefs.map((ref) => `- ${ref.claim}`),
    "",
    missingContext.length > 0 ? "Check before using:" : "",
    ...missingContext.map((question) => `- ${question}`),
  ].filter((line, index, values) => {
    if (line !== "") return true;
    return values[index - 1] !== "" && values[index + 1] !== "";
  });

  return {
    type: artifactType,
    title: titleFromArtifactType(artifactType, title),
    body: lines.join("\n").trim(),
    assumptions: missingContext.slice(0, MAX_ASSUMPTIONS),
    source_refs: sourceRefs,
  };
}

function contextToSourceRefs(
  items: WorkbenchRetrievedContext[],
): WorkbenchArtifactSourceRef[] {
  const seen = new Set<string>();
  const refs: WorkbenchArtifactSourceRef[] = [];

  for (const item of items) {
    const sourceLabel = normalizeString(item.source_label);
    const claim = normalizeString(item.claim);
    if (!sourceLabel || !claim) continue;
    const key = `${item.source_type}:${sourceLabel}:${claim}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({
      source_type: item.source_type,
      source_label: sourceLabel,
      source_url: normalizeNullableString(item.source_url),
      claim,
    });
    if (refs.length >= MAX_SOURCE_REFS) break;
  }

  return refs;
}

function titleFromArtifactType(
  type: WorkbenchArtifactType,
  fallback: string,
): string {
  if (type === "client_email") return "Client email draft";
  if (type === "brief_outline") return "Brief outline";
  if (type === "report_section") return "Report section draft";
  if (type === "research_summary") return "Research summary";
  if (type === "action_plan") return "Action plan";
  if (type === "meeting_prep") return "Meeting prep";
  if (type === "options_recommendation") return "Options and recommendation";
  return fallback;
}

function parseWorkbenchArtifact(
  raw: string,
  preflightResult: WorkbenchPreflightResult,
): WorkbenchArtifact | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return null;
  }

  const obj = asRecord(parsed);
  const artifactValue = asRecord(obj?.artifact) ?? obj;
  return normalizeWorkbenchArtifact(artifactValue, preflightResult);
}

function normalizeWorkbenchArtifact(
  value: Record<string, unknown> | null,
  preflightResult: WorkbenchPreflightResult,
): WorkbenchArtifact | null {
  if (!value) return null;

  const title = normalizeString(value.title);
  const body = normalizeString(value.body);
  if (!title || !body) return null;

  return {
    type: isWorkbenchArtifactType(value.type)
      ? value.type
      : inferWorkbenchArtifactType(preflightResult),
    title,
    body,
    assumptions: normalizeStringList(value.assumptions, MAX_ASSUMPTIONS),
    source_refs: normalizeSourceRefs(value.source_refs),
  };
}

function normalizeSourceRefs(value: unknown): WorkbenchArtifactSourceRef[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const obj = asRecord(item);
      const sourceLabel = normalizeString(obj?.source_label);
      const claim = normalizeString(obj?.claim);
      if (!sourceLabel || !claim) return null;
      return {
        source_type: normalizeSourceType(obj?.source_type),
        source_label: sourceLabel,
        source_url: normalizeNullableString(obj?.source_url),
        claim,
      };
    })
    .filter((item): item is WorkbenchArtifactSourceRef => item !== null)
    .slice(0, MAX_SOURCE_REFS);
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

function isWorkbenchArtifactType(value: unknown): value is WorkbenchArtifactType {
  return (
    value === "client_email" ||
    value === "brief_outline" ||
    value === "report_section" ||
    value === "research_summary" ||
    value === "action_plan" ||
    value === "meeting_prep" ||
    value === "options_recommendation" ||
    value === "notion_doc"
  );
}

function normalizeSourceType(
  value: unknown,
): WorkbenchArtifactSourceRef["source_type"] {
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

function normalizeStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeString).filter(Boolean).slice(0, maxItems);
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
