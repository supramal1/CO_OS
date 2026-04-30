import Anthropic from "@anthropic-ai/sdk";
import type { WorkbenchArtifact } from "./make";
import type { WorkbenchPreflightResult } from "./types";

const DEFAULT_MODEL = "claude-3-5-sonnet-latest";
const MAX_REVIEW_ITEMS = 8;

export type WorkbenchReviewStatus =
  | "needs_revision"
  | "approved_with_checks"
  | "approved";

export type WorkbenchReview = {
  senior_challenge: string[];
  assumptions: string[];
  evidence_gaps: string[];
  cookbook_check: string[];
  tone_check: string[];
  manual_verification: string[];
  overall_status: WorkbenchReviewStatus;
};

export type WorkbenchReviewModelClient = {
  create(input: {
    system: string;
    prompt: string;
    temperature: number;
    maxTokens: number;
  }): Promise<string>;
};

export type WorkbenchReviewResult = {
  status: "reviewed";
  review: WorkbenchReview;
  warnings?: string[];
};

export async function reviewWorkbenchArtifact(input: {
  ask: string;
  preflightResult: WorkbenchPreflightResult;
  artifact: WorkbenchArtifact;
  modelClient?: WorkbenchReviewModelClient | null;
}): Promise<WorkbenchReviewResult> {
  const deterministic = buildDeterministicReview(input);
  const warnings: string[] = [];

  if (!input.modelClient) {
    return {
      status: "reviewed",
      review: withOverallStatus(deterministic),
    };
  }

  let modelReview: Partial<WorkbenchReview> | null = null;
  try {
    const raw = await input.modelClient.create({
      system: [
        "You are the Workbench Review stage.",
        "Review the artefact like a senior operator before staff save or send it.",
        "Return only strict JSON with senior_challenge, assumptions, evidence_gaps, cookbook_check, tone_check, manual_verification, and overall_status.",
        "Do not use em dashes.",
      ].join(" "),
      prompt: buildWorkbenchReviewPrompt(input),
      temperature: 0.1,
      maxTokens: 1400,
    });
    modelReview = parseWorkbenchReview(raw);
  } catch {
    warnings.push("workbench_review_model_failed");
  }

  return {
    status: "reviewed",
    review: withOverallStatus(mergeReviews(deterministic, modelReview)),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export function createWorkbenchReviewAnthropicModelClient(input: {
  apiKey?: string | null;
  model?: string | null;
}): WorkbenchReviewModelClient | null {
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

function buildDeterministicReview(input: {
  preflightResult: WorkbenchPreflightResult;
  artifact: WorkbenchArtifact;
}): WorkbenchReview {
  const review = emptyReview();
  const body = input.artifact.body.trim();

  if (body.length < 80) {
    review.senior_challenge.push(
      "The draft is thin. Add the key rationale, decision, or next step before using it.",
    );
  }

  if (input.artifact.source_refs.length === 0 && hasFactualClaim(body)) {
    review.evidence_gaps.push(
      "The draft makes factual claims without a source reference.",
    );
  }

  for (const assumption of input.artifact.assumptions) {
    review.assumptions.push(assumption);
  }
  for (const missing of input.preflightResult.missing_context) {
    review.assumptions.push(`Missing context: ${missing.question}`);
    review.manual_verification.push(`Verify manually: ${missing.question}`);
  }

  review.cookbook_check.push(
    "No specific Cookbook rubric was available for this review.",
  );
  review.manual_verification.push(
    "Check the relevant Cookbook standard before sending or saving.",
  );

  if (isClientFacing(input.preflightResult) && isApologeticHeavy(body)) {
    review.tone_check.push(
      "Tone may be too apologetic for a client update; make it direct and action-oriented.",
    );
  }

  return withOverallStatus(review);
}

function buildWorkbenchReviewPrompt(input: {
  ask: string;
  preflightResult: WorkbenchPreflightResult;
  artifact: WorkbenchArtifact;
}): string {
  return [
    "Review this Workbench artefact before the user saves or sends it.",
    "",
    `User ask: ${input.ask}`,
    "",
    "Preflight result:",
    JSON.stringify(input.preflightResult, null, 2),
    "",
    "Artefact:",
    JSON.stringify(input.artifact, null, 2),
    "",
    "Return JSON exactly shaped as:",
    JSON.stringify(
      {
        review: {
          senior_challenge: ["string"],
          assumptions: ["string"],
          evidence_gaps: ["string"],
          cookbook_check: ["string"],
          tone_check: ["string"],
          manual_verification: ["string"],
          overall_status: "needs_revision | approved_with_checks | approved",
        },
      },
      null,
      2,
    ),
  ].join("\n");
}

function parseWorkbenchReview(raw: string): Partial<WorkbenchReview> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return null;
  }

  const obj = asRecord(parsed);
  const review = asRecord(obj?.review) ?? obj;
  if (!review) return null;

  return {
    senior_challenge: normalizeStringList(review.senior_challenge),
    assumptions: normalizeStringList(review.assumptions),
    evidence_gaps: normalizeStringList(review.evidence_gaps),
    cookbook_check: normalizeStringList(review.cookbook_check),
    tone_check: normalizeStringList(review.tone_check),
    manual_verification: normalizeStringList(review.manual_verification),
    overall_status: normalizeReviewStatus(review.overall_status),
  };
}

function mergeReviews(
  base: WorkbenchReview,
  model: Partial<WorkbenchReview> | null,
): WorkbenchReview {
  if (!model) return base;

  return {
    senior_challenge: mergeReviewItems(
      base.senior_challenge,
      model.senior_challenge,
    ),
    assumptions: mergeReviewItems(base.assumptions, model.assumptions),
    evidence_gaps: mergeReviewItems(base.evidence_gaps, model.evidence_gaps),
    cookbook_check: mergeReviewItems(base.cookbook_check, model.cookbook_check),
    tone_check: mergeReviewItems(base.tone_check, model.tone_check),
    manual_verification: mergeReviewItems(
      base.manual_verification,
      model.manual_verification,
    ),
    overall_status: strongestStatus(base.overall_status, model.overall_status),
  };
}

function withOverallStatus(review: WorkbenchReview): WorkbenchReview {
  return {
    ...review,
    overall_status: deriveOverallStatus(review),
  };
}

function deriveOverallStatus(review: WorkbenchReview): WorkbenchReviewStatus {
  if (review.senior_challenge.length > 0 || review.evidence_gaps.length > 0) {
    return "needs_revision";
  }
  if (
    review.assumptions.length > 0 ||
    review.cookbook_check.length > 0 ||
    review.tone_check.length > 0 ||
    review.manual_verification.length > 0
  ) {
    return "approved_with_checks";
  }
  return "approved";
}

function strongestStatus(
  left: WorkbenchReviewStatus,
  right: WorkbenchReviewStatus | undefined,
): WorkbenchReviewStatus {
  if (left === "needs_revision" || right === "needs_revision") {
    return "needs_revision";
  }
  if (left === "approved_with_checks" || right === "approved_with_checks") {
    return "approved_with_checks";
  }
  return "approved";
}

function mergeReviewItems(left: string[], right: string[] = []): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...left, ...right]) {
    const normalized = normalizeString(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
    if (merged.length >= MAX_REVIEW_ITEMS) break;
  }
  return merged;
}

function emptyReview(): WorkbenchReview {
  return {
    senior_challenge: [],
    assumptions: [],
    evidence_gaps: [],
    cookbook_check: [],
    tone_check: [],
    manual_verification: [],
    overall_status: "approved",
  };
}

function hasFactualClaim(body: string): boolean {
  return /\b(is|are|was|were|will|has|have|recent|performance|data|metric|because)\b/i.test(
    body,
  );
}

function isClientFacing(preflightResult: WorkbenchPreflightResult): boolean {
  const decoded = preflightResult.decoded_task;
  return [decoded.requester, decoded.deliverable_type, decoded.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes("client");
}

function isApologeticHeavy(body: string): boolean {
  return /\b(sorry|apologise|apologize|apology|unfortunately)\b/i.test(body);
}

function normalizeReviewStatus(value: unknown): WorkbenchReviewStatus | undefined {
  if (
    value === "needs_revision" ||
    value === "approved_with_checks" ||
    value === "approved"
  ) {
    return value;
  }
  return undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeString).filter(Boolean).slice(0, MAX_REVIEW_ITEMS);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
