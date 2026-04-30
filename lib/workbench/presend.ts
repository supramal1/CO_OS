import type {
  BuildPresendPromptInput,
  WorkbenchPresendArtifactIntent,
  WorkbenchPresendArtifactSpec,
  WorkbenchPresendQualityCheck,
  WorkbenchPresendResult,
  WorkbenchPresendSaveBackRequirement,
  WorkbenchPresendSection,
} from "./presend-types";
import type { WorkbenchRetrievedContext } from "./types";

export const WORKBENCH_PRESEND_SKILL_NAME = "workbench-presend";

export function buildPresendPrompt(input: BuildPresendPromptInput): string {
  return [
    "Run Workbench Presend on the prior Workbench output and draft/spec input.",
    "",
    "Return only valid JSON with these exact top-level keys: artifact_intent, artifact_spec, quality_checks, save_back_requirements, warnings.",
    "Do not use em dashes.",
    "Do not generate finished files or save anything. Return only the structured artifact intent/spec and save-back requirements.",
    "",
    "JSON shape:",
    JSON.stringify(
      {
        artifact_intent: {
          artifact_type:
            "docx_scaffold | pptx_scaffold | sheets_scaffold | notion_update | calendar_update | message_review | other",
          title: "string",
          audience: "string or null",
          purpose: "string",
        },
        artifact_spec: {
          format: "string",
          sections: [{ heading: "string", purpose: "string or null" }],
          source_context: [
            {
              claim: "string",
              source_type: "notion | cornerstone | calendar | placeholder",
              source_label: "string",
              source_url: "string or null",
            },
          ],
        },
        quality_checks: [
          { check: "string", status: "pass | warn | fail", detail: "string or null" },
        ],
        save_back_requirements: [
          {
            target: "drive | notion | calendar | none",
            action: "string",
            required: true,
            reason: "string or null",
          },
        ],
        warnings: ["string"],
      },
      null,
      2,
    ),
    "",
    "Prior Workbench/preflight output:",
    JSON.stringify(input.preflightResult, null, 2),
    "",
    "Draft input:",
    input.draftInput?.trim() || "No draft input provided.",
    "",
    "Artifact/spec input:",
    input.artifactSpecInput?.trim() || "No artifact/spec input provided.",
  ].join("\n");
}

export function parseWorkbenchPresendResult(raw: string): WorkbenchPresendResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    throw new Error(
      `workbench_presend_invalid_json: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return normalizePresendResult(parsed);
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

function normalizePresendResult(value: unknown): WorkbenchPresendResult {
  const obj = asRecord(value);
  if (!obj) throw new Error("workbench_presend_invalid_shape");

  return {
    artifact_intent: normalizeArtifactIntent(obj.artifact_intent),
    artifact_spec: normalizeArtifactSpec(obj.artifact_spec),
    quality_checks: normalizeQualityChecks(obj.quality_checks),
    save_back_requirements: normalizeSaveBackRequirements(
      obj.save_back_requirements,
    ),
    warnings: normalizeStringList(obj.warnings),
  };
}

function normalizeArtifactIntent(value: unknown): WorkbenchPresendArtifactIntent {
  const obj = asRecord(value);
  return {
    artifact_type: asString(obj?.artifact_type, "other"),
    title: asString(obj?.title, "Untitled artifact"),
    audience: asNullableString(obj?.audience),
    purpose: asString(obj?.purpose, "Prepare artifact for review."),
  };
}

function normalizeArtifactSpec(value: unknown): WorkbenchPresendArtifactSpec {
  const obj = asRecord(value);
  return {
    format: asString(obj?.format, "structured_note"),
    sections: normalizeSections(obj?.sections),
    source_context: normalizeSourceContext(obj?.source_context),
  };
}

function normalizeSections(value: unknown): WorkbenchPresendSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { heading: item, purpose: null };
      const obj = asRecord(item);
      const heading = asString(obj?.heading);
      if (!heading) return null;
      return { heading, purpose: asNullableString(obj?.purpose) };
    })
    .filter((item): item is WorkbenchPresendSection => item !== null);
}

function normalizeSourceContext(value: unknown): WorkbenchRetrievedContext[] {
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

function normalizeQualityChecks(value: unknown): WorkbenchPresendQualityCheck[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const obj = asRecord(item);
      const check = asString(obj?.check);
      if (!check) return null;
      return {
        check,
        status: normalizeCheckStatus(obj?.status),
        detail: asNullableString(obj?.detail),
      };
    })
    .filter((item): item is WorkbenchPresendQualityCheck => item !== null);
}

function normalizeSaveBackRequirements(
  value: unknown,
): WorkbenchPresendSaveBackRequirement[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const obj = asRecord(item);
      const target = asString(obj?.target);
      const action = asString(obj?.action);
      if (!target || !action) return null;
      return {
        target,
        action,
        required: typeof obj?.required === "boolean" ? obj.required : false,
        reason: asNullableString(obj?.reason),
      };
    })
    .filter(
      (item): item is WorkbenchPresendSaveBackRequirement => item !== null,
    );
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

function normalizeCheckStatus(
  value: unknown,
): WorkbenchPresendQualityCheck["status"] {
  if (value === "pass" || value === "warn" || value === "fail") return value;
  return "warn";
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
