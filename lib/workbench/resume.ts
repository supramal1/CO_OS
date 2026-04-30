import { getWorkbenchRun } from "./run-history";
import type { WorkbenchRunHistoryRow } from "./run-history";
import type { WorkbenchMissingContext } from "./types";
import {
  buildWorkbenchWorkflowState,
  deriveWorkbenchContextQuestions,
  type WorkbenchContextAnswerInput,
  type WorkbenchWorkflowState,
} from "./workflow";

export const WORKBENCH_RESUME_ACTIONS = [
  "answer_context",
  "continue_with_assumptions",
  "stop_run",
] as const;

export type WorkbenchResumeAction = (typeof WORKBENCH_RESUME_ACTIONS)[number];

export type WorkbenchResumeAnswer = {
  question: string;
  answer: string;
};

export type WorkbenchResumeRequest = {
  action: WorkbenchResumeAction;
  answers?: WorkbenchResumeAnswer[] | Record<string, unknown>;
};

export type WorkbenchResumeInput = WorkbenchResumeRequest & {
  userId: string;
  runId: string;
};

export type WorkbenchResumeSafeResult = {
  run_id: string;
  action: WorkbenchResumeAction;
  status: "resumed" | "stopped";
  context_answers: WorkbenchResumeAnswer[];
  unresolved_context: WorkbenchMissingContext[];
  workflow: WorkbenchWorkflowState;
  warnings: string[];
};

export type WorkbenchResumeResult =
  | { status: "ok"; resume: WorkbenchResumeSafeResult }
  | { status: "not_found"; error: "workbench_run_not_found" }
  | {
      status: "unavailable";
      error: "workbench_run_history_unavailable";
    }
  | {
      status: "error";
      error: "workbench_run_history_failed" | "workbench_resume_failed";
      detail: string;
    };

type WorkbenchRunGetResult =
  | { status: "ok"; run: WorkbenchRunHistoryRow | null }
  | { status: "unavailable"; error: "workbench_run_history_unavailable" }
  | { status: "error"; error: "workbench_run_history_failed"; detail: string };

export type ResumeWorkbenchRunDeps = {
  getRun?: (input: {
    userId: string;
    id: string;
  }) => Promise<WorkbenchRunGetResult>;
  saveResume?: (input: {
    userId: string;
    run: WorkbenchRunHistoryRow;
    resume: WorkbenchResumeSafeResult;
  }) => Promise<void>;
};

export async function resumeWorkbenchRun(
  input: WorkbenchResumeInput,
  deps: ResumeWorkbenchRunDeps = {},
): Promise<WorkbenchResumeResult> {
  const getRun = deps.getRun ?? getWorkbenchRun;
  const result = await getRun({ userId: input.userId, id: input.runId });

  if (result.status === "unavailable") {
    return { status: "unavailable", error: result.error };
  }
  if (result.status === "error") {
    return { status: "error", error: result.error, detail: result.detail };
  }
  if (!result.run) {
    return { status: "not_found", error: "workbench_run_not_found" };
  }

  const resume = buildResumeResult({
    run: result.run,
    action: input.action,
    answers: input.answers,
  });

  try {
    await deps.saveResume?.({
      userId: input.userId,
      run: result.run,
      resume,
    });
  } catch (err) {
    return {
      status: "error",
      error: "workbench_resume_failed",
      detail: errorMessage(err),
    };
  }

  return { status: "ok", resume };
}

export function normalizeWorkbenchResumeAction(
  value: unknown,
): WorkbenchResumeAction | null {
  if (typeof value !== "string") return null;
  const action = value.trim();
  return WORKBENCH_RESUME_ACTIONS.includes(action as WorkbenchResumeAction)
    ? (action as WorkbenchResumeAction)
    : null;
}

function buildResumeResult(input: {
  run: WorkbenchRunHistoryRow;
  action: WorkbenchResumeAction;
  answers: WorkbenchResumeRequest["answers"];
}): WorkbenchResumeSafeResult {
  const missingContext = input.run.result.missing_context ?? [];
  const answers = labelAnswersWithQuestions(
    input.run,
    normalizeAnswers(input.answers),
  );
  const mergedAnswers =
    input.action === "continue_with_assumptions"
      ? mergeWithAssumptions(missingContext, answers)
      : answers;
  const workflow =
    input.action === "stop_run"
      ? buildWorkbenchWorkflowState(input.run.result)
      : buildWorkbenchWorkflowState(input.run.result, {
          answers: toWorkflowAnswerInputs(
            input.run,
            input.action === "continue_with_assumptions" ? answers : mergedAnswers,
          ),
          continueWithAssumptions: input.action === "continue_with_assumptions",
        });
  const unresolvedContext =
    input.action === "stop_run"
      ? missingContext
      : unresolvedContextFromWorkflow(input.run, workflow);

  return {
    run_id: input.run.id,
    action: input.action,
    status: input.action === "stop_run" ? "stopped" : "resumed",
    context_answers: mergedAnswers,
    unresolved_context: unresolvedContext,
    workflow,
    warnings: warningsFor(input.action, unresolvedContext),
  };
}

function labelAnswersWithQuestions(
  run: WorkbenchRunHistoryRow,
  answers: WorkbenchResumeAnswer[],
): WorkbenchResumeAnswer[] {
  const questions = deriveWorkbenchContextQuestions(run.result);
  const questionsById = new Map(
    questions.map((question) => [question.id, question.question]),
  );

  return answers.map((answer) => ({
    ...answer,
    question: questionsById.get(answer.question) ?? answer.question,
  }));
}

function unresolvedContextFromWorkflow(
  run: WorkbenchRunHistoryRow,
  workflow: WorkbenchWorkflowState,
): WorkbenchMissingContext[] {
  const answeredIds = new Set(
    workflow.context_answers.map((answer) => answer.question_id),
  );
  const questionIdsByText = new Map(
    workflow.context_questions.map((question) => [
      normalizeKey(question.question),
      question.id,
    ]),
  );

  return (run.result.missing_context ?? []).filter((item) => {
    const id = questionIdsByText.get(normalizeKey(item.question));
    return id ? !answeredIds.has(id) : true;
  });
}

function normalizeAnswers(
  answers: WorkbenchResumeRequest["answers"],
): WorkbenchResumeAnswer[] {
  if (!answers) return [];

  const rawAnswers = Array.isArray(answers)
    ? answers
    : Object.entries(answers).map(([question, answer]) => ({ question, answer }));

  const merged = new Map<string, WorkbenchResumeAnswer>();
  for (const item of rawAnswers) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const question = normalizeString(record.question);
    const answer = normalizeString(record.answer);
    if (!question || !answer) continue;
    merged.set(normalizeKey(question), { question, answer });
  }
  return [...merged.values()];
}

function mergeWithAssumptions(
  missingContext: WorkbenchMissingContext[],
  answers: WorkbenchResumeAnswer[],
): WorkbenchResumeAnswer[] {
  const merged = new Map(
    answers.map((answer) => [normalizeKey(answer.question), answer] as const),
  );

  for (const item of missingContext) {
    const key = normalizeKey(item.question);
    if (!merged.has(key)) {
      merged.set(key, {
        question: item.question,
        answer: "Continue with available context and clearly label assumptions.",
      });
    }
  }

  return [...merged.values()];
}

function toWorkflowAnswerInputs(
  run: WorkbenchRunHistoryRow,
  answers: WorkbenchResumeAnswer[],
): WorkbenchContextAnswerInput[] {
  const questions = deriveWorkbenchContextQuestions(run.result);
  const ids = new Set(questions.map((question) => question.id));
  const idsByQuestion = new Map(
    questions.map((question) => [normalizeKey(question.question), question.id]),
  );

  return answers.flatMap((answer) => {
    const questionId = ids.has(answer.question)
      ? answer.question
      : idsByQuestion.get(normalizeKey(answer.question));
    return questionId
      ? [{ id: questionId, answer: answer.answer, source: "user" as const }]
      : [];
  });
}

function warningsFor(
  action: WorkbenchResumeAction,
  unresolvedContext: WorkbenchMissingContext[],
): string[] {
  if (action === "stop_run") return ["Run stopped by staff."];
  if (action === "continue_with_assumptions") {
    return ["Continuing with available context and labelled assumptions."];
  }
  if (unresolvedContext.length > 0) {
    return ["Some requested context remains unanswered."];
  }
  return [];
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
