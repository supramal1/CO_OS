import type {
  WorkbenchMissingContext,
  WorkbenchPreflightResult,
  WorkbenchRetrievedContext,
} from "./types";

export const WORKBENCH_WORKFLOW_STAGES = [
  "understand",
  "context_needed",
  "gather",
  "make",
  "review",
  "save",
] as const;

export type WorkbenchWorkflowStage = (typeof WORKBENCH_WORKFLOW_STAGES)[number];

export type WorkbenchWorkflowStageStatus =
  | "complete"
  | "current"
  | "ready"
  | "blocked"
  | "pending";

export type WorkbenchContextAnswerType =
  | "text"
  | "choice"
  | "date"
  | "source_search";

export type WorkbenchContextSource =
  | "notion"
  | "cornerstone"
  | "calendar"
  | "user";

export type WorkbenchContextQuestion = {
  id: string;
  question: string;
  why: string;
  answer_type: WorkbenchContextAnswerType;
  required: boolean;
  suggested_sources: WorkbenchContextSource[];
  assumption_fallback: string;
};

export type WorkbenchContextAnswerInput =
  | {
      id: string;
      answer: unknown;
      source?: WorkbenchContextSource | string | null;
    }
  | {
      question_id: string;
      value: unknown;
      source?: WorkbenchContextSource | string | null;
    };

export type WorkbenchContextAnswer = {
  question_id: string;
  answer: string;
  source: WorkbenchContextSource | "assumption" | "unknown";
  assumed: boolean;
};

export type WorkbenchWorkflowStageState = {
  stage: WorkbenchWorkflowStage;
  status: WorkbenchWorkflowStageStatus;
  blocked_by: string[];
};

export type WorkbenchWorkflowState = {
  current_stage: WorkbenchWorkflowStage;
  stages: WorkbenchWorkflowStageState[];
  context_questions: WorkbenchContextQuestion[];
  context_answers: WorkbenchContextAnswer[];
  missing_required_context_count: number;
  can_continue_with_assumptions: boolean;
  using_assumptions: boolean;
};

export type WorkbenchQuestionOptions = {
  required?: boolean;
  suggestedSources?: WorkbenchContextSource[];
  sourceSearchEnabled?: boolean;
};

export type WorkbenchWorkflowOptions = WorkbenchQuestionOptions & {
  answers?:
    | WorkbenchContextAnswerInput[]
    | WorkbenchContextAnswer[]
    | Record<string, unknown>;
  continueWithAssumptions?: boolean;
};

export function buildWorkbenchWorkflowState(
  preflightResult: WorkbenchPreflightResult,
  options: WorkbenchWorkflowOptions = {},
): WorkbenchWorkflowState {
  const contextQuestions = deriveWorkbenchContextQuestions(
    preflightResult,
    options,
  );
  const contextAnswers = mergeWorkbenchContextAnswers(
    contextQuestions,
    options.answers,
    { continueWithAssumptions: options.continueWithAssumptions === true },
  );
  const answered = new Set(contextAnswers.map((answer) => answer.question_id));
  const missingRequiredQuestions = contextQuestions.filter(
    (question) => question.required && !answered.has(question.id),
  );
  const missingRequiredContextCount = missingRequiredQuestions.length;
  const canProceed = missingRequiredContextCount === 0;
  const currentStage: WorkbenchWorkflowStage = canProceed
    ? "gather"
    : "context_needed";

  return {
    current_stage: currentStage,
    stages: buildStageStates(currentStage, missingRequiredQuestions),
    context_questions: contextQuestions,
    context_answers: contextAnswers,
    missing_required_context_count: missingRequiredContextCount,
    can_continue_with_assumptions: missingRequiredContextCount > 0,
    using_assumptions: contextAnswers.some((answer) => answer.assumed),
  };
}

export function deriveWorkbenchContextQuestions(
  preflightResult: WorkbenchPreflightResult,
  options: WorkbenchQuestionOptions = {},
): WorkbenchContextQuestion[] {
  const missingContext = Array.isArray(preflightResult.missing_context)
    ? preflightResult.missing_context
    : [];
  const seenIds = new Map<string, number>();

  return missingContext
    .map((item) =>
      normalizeContextQuestion(item, preflightResult.retrieved_context, options),
    )
    .filter((question): question is WorkbenchContextQuestion => question !== null)
    .map((question) => {
      const count = seenIds.get(question.id) ?? 0;
      seenIds.set(question.id, count + 1);
      return count === 0
        ? question
        : { ...question, id: `${question.id}-${count + 1}` };
    });
}

export function mergeWorkbenchContextAnswers(
  questions: WorkbenchContextQuestion[],
  answers?:
    | WorkbenchContextAnswerInput[]
    | WorkbenchContextAnswer[]
    | Record<string, unknown>,
  options: { continueWithAssumptions?: boolean } = {},
): WorkbenchContextAnswer[] {
  const normalizedAnswers = normalizeAnswerInputs(answers);
  const merged: WorkbenchContextAnswer[] = [];

  for (const question of questions) {
    const directAnswer = normalizedAnswers.get(question.id);
    const normalized = normalizeAnswerValue(directAnswer?.answer);
    if (normalized) {
      merged.push({
        question_id: question.id,
        answer: normalized,
        source: normalizeAnswerSource(directAnswer?.source),
        assumed: false,
      });
      continue;
    }

    if (options.continueWithAssumptions && question.assumption_fallback) {
      merged.push({
        question_id: question.id,
        answer: question.assumption_fallback,
        source: "assumption",
        assumed: true,
      });
    }
  }

  return merged;
}

function buildStageStates(
  currentStage: WorkbenchWorkflowStage,
  missingRequiredQuestions: WorkbenchContextQuestion[],
): WorkbenchWorkflowStageState[] {
  const blockedBy = missingRequiredQuestions.map((question) => question.id);
  const hasRequiredMissing = blockedBy.length > 0;

  return WORKBENCH_WORKFLOW_STAGES.map((stage) => {
    if (stage === "understand") {
      return { stage, status: "complete", blocked_by: [] };
    }
    if (stage === "context_needed") {
      return {
        stage,
        status: currentStage === stage ? "current" : "complete",
        blocked_by: currentStage === stage ? blockedBy : [],
      };
    }
    if (stage === "gather" || stage === "make") {
      return {
        stage,
        status: hasRequiredMissing ? "blocked" : "ready",
        blocked_by: hasRequiredMissing ? blockedBy : [],
      };
    }
    return { stage, status: "pending", blocked_by: [] };
  });
}

function normalizeContextQuestion(
  item: WorkbenchMissingContext,
  retrievedContext: WorkbenchRetrievedContext[],
  options: WorkbenchQuestionOptions,
): WorkbenchContextQuestion | null {
  const question = cleanText(item.question);
  if (!question) return null;

  const why = cleanText(item.why) || "Needed to complete the task accurately.";
  const suggestedSources = deriveSuggestedSources(
    question,
    retrievedContext,
    options,
  );

  return {
    id: stableQuestionId(question),
    question,
    why,
    answer_type: suggestedSources.length > 0 ? "source_search" : "text",
    required: options.required ?? true,
    suggested_sources: suggestedSources,
    assumption_fallback: `Proceed with a clearly marked assumption for: ${question}`,
  };
}

function deriveSuggestedSources(
  question: string,
  retrievedContext: WorkbenchRetrievedContext[],
  options: WorkbenchQuestionOptions,
): WorkbenchContextSource[] {
  if (options.sourceSearchEnabled === false) return [];
  if (options.suggestedSources?.length) return uniqueSources(options.suggestedSources);

  const sources = uniqueSources(
    retrievedContext.reduce<WorkbenchContextSource[]>((acc, item) => {
      if (
        item.source_type === "notion" ||
        item.source_type === "cornerstone" ||
        item.source_type === "calendar"
      ) {
        acc.push(item.source_type);
      }
      return acc;
    }, []),
  );
  if (sources.length > 0) return sources;

  const lowerQuestion = question.toLowerCase();
  if (/\b(meeting|deadline|calendar|when|date)\b/.test(lowerQuestion)) {
    return ["calendar"];
  }
  if (/\b(profile|preference|context|history|memory|client)\b/.test(lowerQuestion)) {
    return ["cornerstone", "notion"];
  }
  return ["notion", "cornerstone"];
}

function normalizeAnswerInputs(
  answers?:
    | WorkbenchContextAnswerInput[]
    | WorkbenchContextAnswer[]
    | Record<string, unknown>,
): Map<string, { answer: unknown; source?: string | null }> {
  const normalized = new Map<string, { answer: unknown; source?: string | null }>();
  if (!answers) return normalized;

  if (Array.isArray(answers)) {
    for (const answer of answers) {
      if ("id" in answer) {
        normalized.set(answer.id, { answer: answer.answer, source: answer.source });
      } else if ("answer" in answer) {
        normalized.set(answer.question_id, {
          answer: answer.answer,
          source: answer.source,
        });
      } else {
        normalized.set(answer.question_id, {
          answer: answer.value,
          source: answer.source,
        });
      }
    }
    return normalized;
  }

  for (const [id, answer] of Object.entries(answers)) {
    normalized.set(id, { answer });
  }
  return normalized;
}

function normalizeAnswerValue(value: unknown): string {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => cleanText(String(item)))
          .filter(Boolean),
      ),
    ).join(", ");
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return cleanText(value);
  }
  return "";
}

function normalizeAnswerSource(
  source: WorkbenchContextSource | string | null | undefined,
): WorkbenchContextAnswer["source"] {
  if (
    source === "notion" ||
    source === "cornerstone" ||
    source === "calendar" ||
    source === "user"
  ) {
    return source;
  }
  return "unknown";
}

function uniqueSources(sources: WorkbenchContextSource[]): WorkbenchContextSource[] {
  return Array.from(new Set(sources));
}

function stableQuestionId(question: string): string {
  const slug =
    cleanText(question)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "context";
  return `ctx_${slug}_${hashText(question)}`;
}

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim()
    : "";
}
