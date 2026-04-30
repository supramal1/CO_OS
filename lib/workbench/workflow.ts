import type { WorkbenchRetrievalResult } from "./retrieval/types";
import type { WorkbenchPreflightResult } from "./types";

export type WorkbenchWorkflowStageId =
  | "understand"
  | "gather"
  | "make"
  | "review"
  | "save";

export type WorkbenchWorkflowStageStatus =
  | "locked"
  | "available"
  | "active"
  | "complete"
  | "error";

export type WorkbenchWorkflowStage = {
  id: WorkbenchWorkflowStageId;
  label: string;
  status: WorkbenchWorkflowStageStatus;
  summary: string;
};

export type WorkbenchWorkflowState = {
  current_stage: WorkbenchWorkflowStageId;
  stages: WorkbenchWorkflowStage[];
};

export type BuildWorkbenchWorkflowStateInput = {
  result: WorkbenchPreflightResult;
  retrieval: Partial<
    Pick<
      WorkbenchRetrievalResult,
      "context" | "statuses" | "warnings" | "generated_at"
    >
  >;
};

export function buildWorkbenchWorkflowState(
  input: BuildWorkbenchWorkflowStateInput,
): WorkbenchWorkflowState {
  const contextCount = input.retrieval.context?.length ?? 0;
  const unavailableSources = (input.retrieval.statuses ?? []).filter(
    (status) => status.status !== "ok",
  );

  return {
    current_stage: "understand",
    stages: [
      {
        id: "understand",
        label: "Understand",
        status: "complete",
        summary:
          input.result.decoded_task.summary ||
          "Workbench decoded the task shape.",
      },
      {
        id: "gather",
        label: "Gather",
        status: "complete",
        summary: gatherSummary(contextCount, unavailableSources.length),
      },
      {
        id: "make",
        label: "Make",
        status: "available",
        summary: "Ready to generate a first working artefact.",
      },
      {
        id: "review",
        label: "Review",
        status: "locked",
        summary: "Generate an artefact before review.",
      },
      {
        id: "save",
        label: "Save",
        status: "locked",
        summary: "Review an artefact before saving.",
      },
    ],
  };
}

function gatherSummary(contextCount: number, unavailableCount: number): string {
  const itemLabel = contextCount === 1 ? "item" : "items";
  if (unavailableCount > 0) {
    return `${contextCount} context ${itemLabel} gathered; ${unavailableCount} source checks need attention.`;
  }
  return `${contextCount} context ${itemLabel} gathered.`;
}
