import {
  WORKBENCH_NOTION_KNOWLEDGE_PAGES,
  type WorkbenchNotionKnowledgePage,
} from "./notion";
import {
  appendWorkbenchNotionManagedSections,
  WORKBENCH_NOTION_WRITABLE_PAGES,
  type WorkbenchNotionWriterClient,
} from "./notion-writer";
import type { WorkbenchUserConfig } from "./retrieval/types";
import { getWorkbenchSupabase } from "./supabase";
import type { WorkbenchPreflightResult, WorkbenchStartResponse } from "./types";

const TABLE = "workbench_profile_updates";
const UPDATE_COLUMNS =
  "id,user_id,target_page,source_run_id,candidate_text,status,classification,notion_page_id,notion_block_id,undo_of_update_id,undo_reason,undo_metadata,undone_at,created_at,updated_at" as const;

export const WORKBENCH_PROFILE_UPDATE_STATUSES = [
  "pending",
  "written",
  "needs_more_evidence",
  "skipped",
  "undone",
  "error",
] as const;

export type WorkbenchProfileTargetPage = WorkbenchNotionKnowledgePage;

export type WorkbenchProfileUpdateStatus =
  (typeof WORKBENCH_PROFILE_UPDATE_STATUSES)[number];

export type WorkbenchLearningDecision =
  | "write"
  | "needs_more_evidence"
  | "skip";

export type WorkbenchLearningCandidate = {
  target_page: WorkbenchProfileTargetPage;
  candidate_text: string;
  source_run_id?: string | null;
  evidence_count?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type WorkbenchLearningClassification = {
  decision: WorkbenchLearningDecision;
  target_page: WorkbenchProfileTargetPage;
  candidate_text: string;
  reason: string;
  confidence: number | null;
  evidence_count: number;
  safety_flags: string[];
  model_used: boolean;
};

export type WorkbenchLearningModelClassifier = (
  candidate: WorkbenchLearningCandidate,
) =>
  | Promise<Partial<WorkbenchLearningClassification>>
  | Partial<WorkbenchLearningClassification>;

export type WorkbenchProfileUpdateRow = {
  id: string;
  user_id: string;
  target_page: WorkbenchProfileTargetPage;
  source_run_id: string | null;
  candidate_text: string;
  status: WorkbenchProfileUpdateStatus;
  classification: Record<string, unknown>;
  notion_page_id: string | null;
  notion_block_id: string | null;
  undo_of_update_id: string | null;
  undo_reason: string | null;
  undo_metadata: Record<string, unknown> | null;
  undone_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkbenchProfileUpdateInsertPayload = {
  user_id: string;
  target_page: WorkbenchProfileTargetPage;
  source_run_id: string | null;
  candidate_text: string;
  status: WorkbenchProfileUpdateStatus;
  classification: Record<string, unknown>;
  notion_page_id: string | null;
  notion_block_id: string | null;
  undo_of_update_id: string | null;
  undo_reason: string | null;
  undo_metadata: Record<string, unknown> | null;
  undone_at: string | null;
};

export type WorkbenchProfileUpdateUndoPayload = {
  status: "undone";
  undo_reason: string | null;
  undo_metadata: Record<string, unknown> | null;
  undone_at: string;
  updated_at: string;
};

export type WorkbenchProfileUpdateStore = {
  insertProfileUpdate(
    payload: WorkbenchProfileUpdateInsertPayload,
  ): Promise<WorkbenchProfileUpdateRow>;
  markProfileUpdateUndone(input: {
    userId: string;
    updateId: string;
    payload: WorkbenchProfileUpdateUndoPayload;
  }): Promise<WorkbenchProfileUpdateRow>;
};

export type PersistWorkbenchProfileUpdateInput = {
  userId: string;
  targetPage: WorkbenchProfileTargetPage;
  sourceRunId?: string | null;
  candidateText: string;
  status: WorkbenchProfileUpdateStatus;
  classification?: Record<string, unknown> | null;
  notionPageId?: string | null;
  notionBlockId?: string | null;
  undoOfUpdateId?: string | null;
  undoReason?: string | null;
  undoMetadata?: Record<string, unknown> | null;
  undoneAt?: string | null;
};

export type WorkbenchProfileUpdatePersistResult =
  | { status: "stored"; update: WorkbenchProfileUpdateRow }
  | { status: "unavailable"; error: "workbench_profile_updates_unavailable" }
  | { status: "error"; error: "workbench_profile_update_failed"; detail: string };

export type WorkbenchProfileUpdateUndoResult =
  | { status: "updated"; update: WorkbenchProfileUpdateRow }
  | { status: "unavailable"; error: "workbench_profile_updates_unavailable" }
  | { status: "error"; error: "workbench_profile_update_failed"; detail: string };

export type ClassifyWorkbenchLearningCandidateOptions = {
  modelClassifier?: WorkbenchLearningModelClassifier | null;
};

export type PersistWorkbenchProfileUpdateOptions = {
  store?: WorkbenchProfileUpdateStore | null;
};

export type WorkbenchRunLearningResult = NonNullable<
  WorkbenchStartResponse["profile_update"]
>;

export type ProcessWorkbenchRunLearningInput = {
  userId: string;
  ask: string;
  result: WorkbenchPreflightResult;
  sourceRunId: string;
  config: Pick<WorkbenchUserConfig, "notion_parent_page_id"> | null;
  writerClient: WorkbenchNotionWriterClient | null;
  modelClassifier?: WorkbenchLearningModelClassifier | null;
  store?: WorkbenchProfileUpdateStore | null;
  now?: Date;
};

type SupabaseErrorLike = { message?: string } | null;
type SupabaseResult<T> = PromiseLike<{
  data: T | null;
  error: SupabaseErrorLike;
}>;

type SupabaseLike = {
  from(table: string): {
    insert(payload: WorkbenchProfileUpdateInsertPayload): {
      select(columns: string): {
        single(): SupabaseResult<WorkbenchProfileUpdateRow>;
      };
    };
    update(payload: WorkbenchProfileUpdateUndoPayload): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          select(columns: string): {
            single(): SupabaseResult<WorkbenchProfileUpdateRow>;
          };
        };
      };
    };
  };
};

const SENSITIVE_PATTERNS: Array<{ flag: string; pattern: RegExp }> = [
  {
    flag: "sensitive_health",
    pattern:
      /\b(medical|doctor|therapy|therapist|anxiety|anxious|depression|medication|illness|diagnosis|pregnant|pregnancy|hospital)\b/i,
  },
  {
    flag: "sensitive_credentials",
    pattern:
      /\b(password|passcode|api key|token|secret|credential|private key|oauth)\b/i,
  },
  {
    flag: "sensitive_identity_or_finance",
    pattern:
      /\b(religion|politic|sexuality|immigration|visa|home address|phone number|salary|pay rise|compensation)\b/i,
  },
];

const SPECULATIVE_PATTERN =
  /\b(maybe|might|probably|possibly|i think|i guess|seems like|could be|appears to)\b/i;
const NEGATIVE_PATTERN =
  /\b(hates|terrible|bad at|weakness|struggles with|never responds|poor at|dislikes)\b/i;
const ONE_OFF_PATTERN =
  /\b(today|tomorrow|yesterday|this morning|this afternoon|this evening|this week|next week|deadline|due tomorrow|due today|by monday|by tuesday|by wednesday|by thursday|by friday|by saturday|by sunday)\b/i;

export async function classifyWorkbenchLearningCandidate(
  candidate: WorkbenchLearningCandidate,
  options: ClassifyWorkbenchLearningCandidateOptions = {},
): Promise<WorkbenchLearningClassification> {
  const normalized = normalizeCandidate(candidate);
  const safetyFlags = detectSafetyFlags(normalized.candidate_text);

  if (options.modelClassifier) {
    try {
      const modelResult = await options.modelClassifier(normalized);
      const classification = normalizeModelClassification(
        normalized,
        modelResult,
      );
      return applyHardSafetyGuardrails(classification, safetyFlags, true);
    } catch {
      return fallbackClassification(normalized, safetyFlags, [
        "model_classifier_failed",
      ]);
    }
  }

  return fallbackClassification(normalized, safetyFlags);
}

export function extractWorkbenchLearningCandidatesFromRun(input: {
  ask: string;
  result: WorkbenchPreflightResult;
  sourceRunId?: string | null;
}): WorkbenchLearningCandidate[] {
  const ask = normalizeWhitespace(input.ask);
  const sourceRunId = normalizeOptionalString(input.sourceRunId);
  const candidates: WorkbenchLearningCandidate[] = [];

  for (const preference of extractPreferenceSignals(ask)) {
    candidates.push({
      target_page: "Voice",
      candidate_text: preference,
      source_run_id: sourceRunId,
      evidence_count: 2,
      metadata: {
        source: "ask",
        task_type: input.result.decoded_task.task_type,
      },
    });
  }

  for (const workSignal of extractCurrentWorkSignals(ask)) {
    candidates.push({
      target_page: "Working On",
      candidate_text: workSignal,
      source_run_id: sourceRunId,
      evidence_count: 1,
      metadata: {
        source: "ask",
        task_type: input.result.decoded_task.task_type,
      },
    });
  }

  return dedupeCandidates(candidates);
}

export async function classifyAndPersistWorkbenchLearningCandidate(
  input: {
    userId: string;
    candidate: WorkbenchLearningCandidate;
  },
  options: ClassifyWorkbenchLearningCandidateOptions &
    PersistWorkbenchProfileUpdateOptions = {},
): Promise<{
  classification: WorkbenchLearningClassification;
  persistence: WorkbenchProfileUpdatePersistResult;
}> {
  const classification = await classifyWorkbenchLearningCandidate(
    input.candidate,
    options,
  );
  const persistence = await persistWorkbenchProfileUpdate(
    {
      userId: input.userId,
      targetPage: classification.target_page,
      sourceRunId: input.candidate.source_run_id ?? null,
      candidateText: classification.candidate_text,
      status: updateStatusForDecision(classification.decision),
      classification: classification as unknown as Record<string, unknown>,
    },
    options,
  );

  return { classification, persistence };
}

export async function processWorkbenchRunLearning(
  input: ProcessWorkbenchRunLearningInput,
): Promise<WorkbenchRunLearningResult> {
  const candidates = extractWorkbenchLearningCandidatesFromRun({
    ask: input.ask,
    result: input.result,
    sourceRunId: input.sourceRunId,
  });

  if (candidates.length === 0) {
    return { status: "skipped", reason: "no_learning_candidates" };
  }

  for (const candidate of candidates) {
    const classificationResult = await classifyWorkbenchLearningCandidate(
      candidate,
      { modelClassifier: input.modelClassifier },
    );

    if (classificationResult.decision !== "write") {
      await persistWorkbenchProfileUpdate(
        {
          userId: input.userId,
          targetPage: classificationResult.target_page,
          sourceRunId: input.sourceRunId,
          candidateText: classificationResult.candidate_text,
          status: updateStatusForDecision(classificationResult.decision),
          classification: classificationResult as unknown as Record<
            string,
            unknown
          >,
        },
        { store: input.store },
      );
      continue;
    }

    if (!isRunLearningWritablePage(classificationResult.target_page)) {
      await persistWorkbenchProfileUpdate(
        {
          userId: input.userId,
          targetPage: classificationResult.target_page,
          sourceRunId: input.sourceRunId,
          candidateText: classificationResult.candidate_text,
          status: "needs_more_evidence",
          classification: {
            ...classificationResult,
            reason: "notion_page_not_writable_v1",
          } as unknown as Record<string, unknown>,
        },
        { store: input.store },
      );
      continue;
    }

    const parentPageId = input.config?.notion_parent_page_id?.trim();
    if (!parentPageId || !input.writerClient) {
      await persistWorkbenchProfileUpdate(
        {
          userId: input.userId,
          targetPage: classificationResult.target_page,
          sourceRunId: input.sourceRunId,
          candidateText: classificationResult.candidate_text,
          status: "pending",
          classification: {
            ...classificationResult,
            reason: "notion_writer_not_ready",
          } as unknown as Record<string, unknown>,
        },
        { store: input.store },
      );
      return { status: "skipped", reason: "notion_writer_not_ready" };
    }

    const write = await appendWorkbenchNotionManagedSections({
      parentPageId,
      client: input.writerClient,
      sections: [
        {
          page: classificationResult.target_page,
          heading: learningHeadingForPage(classificationResult.target_page),
          items: [classificationResult.candidate_text],
          sourceLabel: "Workbench ask learning",
        },
      ],
      now: input.now,
    });

    if (write.status !== "written") {
      await persistWorkbenchProfileUpdate(
        {
          userId: input.userId,
          targetPage: classificationResult.target_page,
          sourceRunId: input.sourceRunId,
          candidateText: classificationResult.candidate_text,
          status: "error",
          classification: {
            ...classificationResult,
            reason: write.reason ?? "notion_write_failed",
            warnings: write.warnings,
          } as unknown as Record<string, unknown>,
        },
        { store: input.store },
      );
      return {
        status: "error",
        message: write.reason ?? "Profile learning write failed.",
      };
    }

    const writtenPage = write.writes[0];
    const persistence = await persistWorkbenchProfileUpdate(
      {
        userId: input.userId,
        targetPage: classificationResult.target_page,
        sourceRunId: input.sourceRunId,
        candidateText: classificationResult.candidate_text,
        status: "written",
        classification: classificationResult as unknown as Record<
          string,
          unknown
        >,
        notionPageId: writtenPage?.page_id ?? null,
      },
      { store: input.store },
    );

    return {
      status: "updated",
      targetLabel: classificationResult.target_page,
      canUndo: persistence.status === "stored",
      ...(persistence.status === "stored"
        ? { updateId: persistence.update.id }
        : {}),
    };
  }

  return { status: "skipped", reason: "no_writable_learning_candidates" };
}

export async function persistWorkbenchProfileUpdate(
  input: PersistWorkbenchProfileUpdateInput,
  options: PersistWorkbenchProfileUpdateOptions = {},
): Promise<WorkbenchProfileUpdatePersistResult> {
  const store = resolveProfileUpdateStore(options);
  if (!store) {
    return {
      status: "unavailable",
      error: "workbench_profile_updates_unavailable",
    };
  }

  try {
    const payload: WorkbenchProfileUpdateInsertPayload = {
      user_id: input.userId.trim(),
      target_page: input.targetPage,
      source_run_id: normalizeOptionalString(input.sourceRunId),
      candidate_text: normalizeWhitespace(input.candidateText),
      status: input.status,
      classification: input.classification ?? {},
      notion_page_id: normalizeOptionalString(input.notionPageId),
      notion_block_id: normalizeOptionalString(input.notionBlockId),
      undo_of_update_id: normalizeOptionalString(input.undoOfUpdateId),
      undo_reason: normalizeOptionalString(input.undoReason),
      undo_metadata: input.undoMetadata ?? null,
      undone_at: normalizeOptionalString(input.undoneAt),
    };

    validateProfileUpdatePayload(payload);

    return {
      status: "stored",
      update: await store.insertProfileUpdate(payload),
    };
  } catch (err) {
    return failedPersist(err);
  }
}

export async function markWorkbenchProfileUpdateUndone(
  input: {
    userId: string;
    updateId: string;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
    undoneAt?: string | null;
  },
  options: PersistWorkbenchProfileUpdateOptions = {},
): Promise<WorkbenchProfileUpdateUndoResult> {
  const store = resolveProfileUpdateStore(options);
  if (!store) {
    return {
      status: "unavailable",
      error: "workbench_profile_updates_unavailable",
    };
  }

  try {
    const undoneAt = normalizeOptionalString(input.undoneAt) ?? nowIso();
    return {
      status: "updated",
      update: await store.markProfileUpdateUndone({
        userId: input.userId.trim(),
        updateId: input.updateId.trim(),
        payload: {
          status: "undone",
          undo_reason: normalizeOptionalString(input.reason),
          undo_metadata: input.metadata ?? null,
          undone_at: undoneAt,
          updated_at: undoneAt,
        },
      }),
    };
  } catch (err) {
    return failedUndo(err);
  }
}

export function createSupabaseWorkbenchProfileUpdateStore(
  supabase: SupabaseLike,
): WorkbenchProfileUpdateStore {
  return {
    async insertProfileUpdate(payload) {
      const { data, error } = await supabase
        .from(TABLE)
        .insert(payload)
        .select(UPDATE_COLUMNS)
        .single();

      if (error || !data) {
        throw new Error(errorMessage(error, "Unknown profile update save error."));
      }
      return data;
    },
    async markProfileUpdateUndone(input) {
      const { data, error } = await supabase
        .from(TABLE)
        .update(input.payload)
        .eq("id", input.updateId)
        .eq("user_id", input.userId)
        .select(UPDATE_COLUMNS)
        .single();

      if (error || !data) {
        throw new Error(errorMessage(error, "Unknown profile update undo error."));
      }
      return data;
    },
  };
}

function fallbackClassification(
  candidate: WorkbenchLearningCandidate,
  safetyFlags: string[],
  extraFlags: string[] = [],
): WorkbenchLearningClassification {
  const flags = [...safetyFlags, ...extraFlags];
  const unsafeReason = skipReasonFromFlags(flags);
  if (unsafeReason) {
    return classification(candidate, "skip", unsafeReason, flags, false);
  }

  const text = candidate.candidate_text;
  const lower = text.toLowerCase();
  const evidenceCount = normalizeEvidenceCount(candidate.evidence_count);

  if (
    candidate.target_page === "Voice" &&
    /\b(prefers|preference|likes|default|always|avoid|use|keep|direct|concise|bullets)\b/i.test(
      text,
    )
  ) {
    return classification(candidate, "write", "durable_voice_preference", flags);
  }

  if (
    candidate.target_page === "Working On" &&
    /\b(currently working on|working on|current focus|active project|focused on)\b/i.test(
      lower,
    )
  ) {
    return classification(candidate, "write", "current_work_signal", flags);
  }

  if (
    candidate.target_page === "Personal Profile" &&
    /\b(role|team|works in|responsible for|prefers|default)\b/i.test(lower)
  ) {
    return classification(candidate, "write", "stable_profile_signal", flags);
  }

  if (candidate.target_page === "Patterns") {
    if (
      evidenceCount >= 2 ||
      /\b(repeatedly|usually|often|tends to|pattern)\b/i.test(lower)
    ) {
      return classification(candidate, "write", "repeated_pattern_signal", flags);
    }
    return classification(
      candidate,
      "needs_more_evidence",
      "pattern_needs_repeated_evidence",
      flags,
    );
  }

  return classification(
    candidate,
    "needs_more_evidence",
    "insufficient_durable_signal",
    flags,
  );
}

function normalizeModelClassification(
  candidate: WorkbenchLearningCandidate,
  modelResult: Partial<WorkbenchLearningClassification>,
): WorkbenchLearningClassification {
  const decision = isLearningDecision(modelResult.decision)
    ? modelResult.decision
    : "needs_more_evidence";
  return {
    decision,
    target_page: candidate.target_page,
    candidate_text: candidate.candidate_text,
    reason: normalizeOptionalString(modelResult.reason) ?? "model_classification",
    confidence:
      typeof modelResult.confidence === "number" &&
      Number.isFinite(modelResult.confidence)
        ? modelResult.confidence
        : null,
    evidence_count: normalizeEvidenceCount(candidate.evidence_count),
    safety_flags: Array.isArray(modelResult.safety_flags)
      ? modelResult.safety_flags.filter((flag) => typeof flag === "string")
      : [],
    model_used: true,
  };
}

function applyHardSafetyGuardrails(
  classificationResult: WorkbenchLearningClassification,
  safetyFlags: string[],
  modelUsed: boolean,
): WorkbenchLearningClassification {
  const flags = [...new Set([...classificationResult.safety_flags, ...safetyFlags])];
  const unsafeReason = skipReasonFromFlags(flags);
  if (!unsafeReason) {
    return {
      ...classificationResult,
      safety_flags: flags,
      model_used: modelUsed,
    };
  }

  return {
    ...classificationResult,
    decision: "skip",
    reason: unsafeReason,
    safety_flags: flags,
    model_used: modelUsed,
  };
}

function classification(
  candidate: WorkbenchLearningCandidate,
  decision: WorkbenchLearningDecision,
  reason: string,
  safetyFlags: string[],
  modelUsed = false,
): WorkbenchLearningClassification {
  return {
    decision,
    target_page: candidate.target_page,
    candidate_text: candidate.candidate_text,
    reason,
    confidence: null,
    evidence_count: normalizeEvidenceCount(candidate.evidence_count),
    safety_flags: [...new Set(safetyFlags)],
    model_used: modelUsed,
  };
}

function normalizeCandidate(
  candidate: WorkbenchLearningCandidate,
): WorkbenchLearningCandidate {
  const targetPage = WORKBENCH_NOTION_KNOWLEDGE_PAGES.includes(
    candidate.target_page,
  )
    ? candidate.target_page
    : "Patterns";
  return {
    ...candidate,
    target_page: targetPage,
    candidate_text: normalizeWhitespace(candidate.candidate_text),
    source_run_id: normalizeOptionalString(candidate.source_run_id),
    evidence_count: normalizeEvidenceCount(candidate.evidence_count),
  };
}

function detectSafetyFlags(text: string): string[] {
  const flags: string[] = [];

  for (const { flag, pattern } of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) flags.push(flag);
  }
  if (SPECULATIVE_PATTERN.test(text)) flags.push("speculative_signal");
  if (NEGATIVE_PATTERN.test(text)) flags.push("negative_or_judgmental_signal");
  if (ONE_OFF_PATTERN.test(text)) flags.push("one_off_task_fact");

  return [...new Set(flags)];
}

function skipReasonFromFlags(flags: string[]): string | null {
  if (flags.some((flag) => flag.startsWith("sensitive_"))) {
    return "sensitive_signal";
  }
  if (flags.includes("speculative_signal")) return "speculative_signal";
  if (flags.includes("negative_or_judgmental_signal")) {
    return "negative_or_judgmental_signal";
  }
  if (flags.includes("one_off_task_fact")) return "one_off_task_fact";
  return null;
}

function updateStatusForDecision(
  decision: WorkbenchLearningDecision,
): WorkbenchProfileUpdateStatus {
  if (decision === "write") return "pending";
  if (decision === "needs_more_evidence") return "needs_more_evidence";
  return "skipped";
}

function isRunLearningWritablePage(
  page: WorkbenchProfileTargetPage,
): page is (typeof WORKBENCH_NOTION_WRITABLE_PAGES)[number] {
  return WORKBENCH_NOTION_WRITABLE_PAGES.includes(
    page as (typeof WORKBENCH_NOTION_WRITABLE_PAGES)[number],
  );
}

function learningHeadingForPage(page: WorkbenchProfileTargetPage): string {
  if (page === "Working On") return "Current work signal";
  if (page === "Voice") return "Output preference";
  if (page === "Personal Profile") return "Profile signal";
  return "Usage pattern";
}

function extractPreferenceSignals(ask: string): string[] {
  const preferences: string[] = [];
  const pattern =
    /\b(?:i prefer|i like|please use|please keep|use|keep)\s+([^.!?\n]{3,140})/gi;
  for (const match of ask.matchAll(pattern)) {
    const value = sentenceCase(cleanExtractedSignal(match[1]));
    if (value) preferences.push(`Prefers ${value}.`);
  }
  return preferences;
}

function extractCurrentWorkSignals(ask: string): string[] {
  const workSignals: string[] = [];
  const pattern =
    /\b(?:i am working on|i'm working on|currently working on|working on|current focus is|focus is)\s+([^.!?\n]{3,160})/gi;
  for (const match of ask.matchAll(pattern)) {
    const value = cleanExtractedSignal(match[1]);
    if (value) workSignals.push(`Currently working on ${value}.`);
  }
  return workSignals;
}

function cleanExtractedSignal(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\bplease\b/gi, "")
    .replace(/[,:;]+$/g, "")
    .trim();
}

function sentenceCase(value: string): string {
  if (!value) return value;
  return value[0].toLowerCase() + value.slice(1);
}

function dedupeCandidates(
  candidates: WorkbenchLearningCandidate[],
): WorkbenchLearningCandidate[] {
  const seen = new Set<string>();
  const deduped: WorkbenchLearningCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.target_page}:${candidate.candidate_text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function validateProfileUpdatePayload(
  payload: WorkbenchProfileUpdateInsertPayload,
): void {
  if (!payload.user_id) {
    throw new Error("Workbench profile update user_id is required.");
  }
  if (!payload.candidate_text) {
    throw new Error("Workbench profile update candidate_text is required.");
  }
  if (!WORKBENCH_NOTION_KNOWLEDGE_PAGES.includes(payload.target_page)) {
    throw new Error("Workbench profile update target_page is invalid.");
  }
}

function resolveProfileUpdateStore(
  options: PersistWorkbenchProfileUpdateOptions,
): WorkbenchProfileUpdateStore | null {
  if ("store" in options) return options.store ?? null;
  const supabase = getWorkbenchSupabase() as unknown as SupabaseLike | null;
  return supabase ? createSupabaseWorkbenchProfileUpdateStore(supabase) : null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeEvidenceCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

function isLearningDecision(value: unknown): value is WorkbenchLearningDecision {
  return (
    value === "write" || value === "needs_more_evidence" || value === "skip"
  );
}

function failedPersist(error: unknown): WorkbenchProfileUpdatePersistResult {
  return {
    status: "error",
    error: "workbench_profile_update_failed",
    detail: errorMessage(error, "Unknown profile update save error."),
  };
}

function failedUndo(error: unknown): WorkbenchProfileUpdateUndoResult {
  return {
    status: "error",
    error: "workbench_profile_update_failed",
    detail: errorMessage(error, "Unknown profile update undo error."),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  if (typeof error === "string") return error;
  return fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}
