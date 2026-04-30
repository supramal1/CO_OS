import { describe, expect, it } from "vitest";
import {
  buildWorkbenchWorkflowState,
  deriveWorkbenchContextQuestions,
  mergeWorkbenchContextAnswers,
} from "@/lib/workbench/workflow";
import type { WorkbenchPreflightResult } from "@/lib/workbench/types";

const basePreflight: WorkbenchPreflightResult = {
  decoded_task: {
    summary: "Draft the client response",
    requester: "EM",
    deliverable_type: "written_response",
    task_type: "ask_decode",
  },
  missing_context: [],
  drafted_clarifying_message: "",
  retrieved_context: [],
  suggested_approach: [{ step: "Draft response", rationale: null }],
  time_estimate: {
    estimated_before_minutes: 30,
    estimated_workbench_minutes: 10,
    task_type: "ask_decode",
  },
  warnings: [],
};

function preflightWithMissing(
  missing_context: WorkbenchPreflightResult["missing_context"],
): WorkbenchPreflightResult {
  return {
    ...basePreflight,
    missing_context,
  };
}

function stageStatus(
  state: ReturnType<typeof buildWorkbenchWorkflowState>,
  stage: string,
) {
  return state.stages.find((item) => item.stage === stage)?.status;
}

describe("Workbench workflow state", () => {
  it("marks gather and make ready when there is no missing context", () => {
    const state = buildWorkbenchWorkflowState(basePreflight);

    expect(state.current_stage).toBe("gather");
    expect(state.missing_required_context_count).toBe(0);
    expect(stageStatus(state, "understand")).toBe("complete");
    expect(stageStatus(state, "context_needed")).toBe("complete");
    expect(stageStatus(state, "gather")).toBe("ready");
    expect(stageStatus(state, "make")).toBe("ready");
    expect(state.context_questions).toEqual([]);
  });

  it("moves to context_needed when required context is missing", () => {
    const state = buildWorkbenchWorkflowState(
      preflightWithMissing([
        {
          question: "What deadline should the response optimize for?",
          why: "Needed for priority and scope.",
        },
      ]),
    );

    expect(state.current_stage).toBe("context_needed");
    expect(state.missing_required_context_count).toBe(1);
    expect(stageStatus(state, "context_needed")).toBe("current");
    expect(stageStatus(state, "gather")).toBe("blocked");
    expect(stageStatus(state, "make")).toBe("blocked");
    expect(state.context_questions[0]).toMatchObject({
      question: "What deadline should the response optimize for?",
      why: "Needed for priority and scope.",
      answer_type: "source_search",
      required: true,
      suggested_sources: ["calendar"],
    });
  });

  it("normalizes answers before merging them into workflow state", () => {
    const questions = deriveWorkbenchContextQuestions(
      preflightWithMissing([
        {
          question: "Which stakeholders should be named?",
          why: "Keeps the response specific.",
        },
      ]),
    );

    const answers = mergeWorkbenchContextAnswers(questions, [
      {
        id: questions[0].id,
        answer: ["  Alice  ", "Bob", "Alice", ""],
        source: "user",
      },
    ]);

    expect(answers).toEqual([
      {
        question_id: questions[0].id,
        answer: "Alice, Bob",
        source: "user",
        assumed: false,
      },
    ]);

    const state = buildWorkbenchWorkflowState(
      preflightWithMissing([
        {
          question: "Which stakeholders should be named?",
          why: "Keeps the response specific.",
        },
      ]),
      { answers },
    );
    expect(state.current_stage).toBe("gather");
  });

  it("can continue with explicit assumptions for required missing context", () => {
    const state = buildWorkbenchWorkflowState(
      preflightWithMissing([
        {
          question: "What source should be treated as the latest plan?",
          why: null,
        },
      ]),
      { continueWithAssumptions: true },
    );

    expect(state.current_stage).toBe("gather");
    expect(state.missing_required_context_count).toBe(0);
    expect(state.using_assumptions).toBe(true);
    expect(state.context_answers[0]).toMatchObject({
      source: "assumption",
      assumed: true,
    });
    expect(state.context_answers[0].answer).toContain(
      "Proceed with a clearly marked assumption",
    );
  });

  it("honors source search options", () => {
    const questions = deriveWorkbenchContextQuestions(
      preflightWithMissing([
        {
          question: "Where is the latest client preference recorded?",
          why: "Needed for personalization.",
        },
      ]),
      { suggestedSources: ["cornerstone"], sourceSearchEnabled: true },
    );

    expect(questions[0]).toMatchObject({
      answer_type: "source_search",
      suggested_sources: ["cornerstone"],
    });

    const withoutSearch = deriveWorkbenchContextQuestions(
      preflightWithMissing([
        {
          question: "Where is the latest client preference recorded?",
          why: "Needed for personalization.",
        },
      ]),
      { sourceSearchEnabled: false },
    );

    expect(withoutSearch[0]).toMatchObject({
      answer_type: "text",
      suggested_sources: [],
    });
  });

  it("generates stable ids for the same questions and unique ids for duplicates", () => {
    const first = deriveWorkbenchContextQuestions(
      preflightWithMissing([
        {
          question: "What deadline should the response optimize for?",
          why: "Needed for priority and scope.",
        },
      ]),
    );
    const second = deriveWorkbenchContextQuestions(
      preflightWithMissing([
        {
          question: "What deadline should the response optimize for?",
          why: "Needed for priority and scope.",
        },
      ]),
    );
    const duplicates = deriveWorkbenchContextQuestions(
      preflightWithMissing([
        {
          question: "What deadline should the response optimize for?",
          why: "Needed for priority and scope.",
        },
        {
          question: "What deadline should the response optimize for?",
          why: "Needed for priority and scope.",
        },
      ]),
    );

    expect(first[0].id).toBe(second[0].id);
    expect(duplicates[0].id).toBe(first[0].id);
    expect(duplicates[1].id).toBe(`${first[0].id}-2`);
  });

  it("does not emit em dash text in workflow strings", () => {
    const state = buildWorkbenchWorkflowState(
      preflightWithMissing([
        {
          question: "What context is missing?\u2014include source",
          why: "Needed\u2014for accuracy.",
        },
      ]),
      { continueWithAssumptions: true },
    );

    expect(state.context_questions[0].question).toBe(
      "What context is missing?-include source",
    );
    expect(state.context_questions[0].why).toBe("Needed-for accuracy.");
    expect(JSON.stringify(state)).not.toContain("\u2014");
  });
});
