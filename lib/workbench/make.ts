import Anthropic from "@anthropic-ai/sdk";
import type {
  WorkbenchPreflightResult,
  WorkbenchRetrievedContext,
} from "./types";

const DEFAULT_MODEL = "claude-3-5-sonnet-latest";
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
    return {
      status: "error",
      reason: "workbench_make_failed",
      message:
        "Workbench could not reach the draft generator. Check the local server logs and try again.",
    };
  }

  const artifact = parseWorkbenchArtifact(raw, input.preflightResult);
  if (!artifact) {
    return {
      status: "error",
      reason: "workbench_make_invalid_json",
      message: "Workbench could not turn that into a draft. Please try again.",
    };
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
