import { describe, expect, it, vi } from "vitest";
import type { WorkbenchRunHistoryRow } from "@/lib/workbench/run-history";
import type { WorkbenchResumeResult } from "@/lib/workbench/resume";
import { resumeWorkbenchRun } from "@/lib/workbench/resume";
import { deriveWorkbenchContextQuestions } from "@/lib/workbench/workflow";

const run: WorkbenchRunHistoryRow = {
  id: "run-1",
  user_id: "principal_123",
  ask: "Help me reply",
  result: {
    decoded_task: {
      summary: "Reply",
      requester: "Client",
      deliverable_type: "email",
      task_type: "ask_decode",
    },
    missing_context: [
      { question: "What is the deadline?", why: "Needed for prioritization" },
      { question: "Who signs off?", why: null },
    ],
    drafted_clarifying_message: "Can you confirm deadline and approver?",
    retrieved_context: [],
    suggested_approach: [],
    time_estimate: {
      estimated_before_minutes: 30,
      estimated_workbench_minutes: 10,
      task_type: "ask_decode",
    },
    warnings: [],
  },
  retrieval: {
    context: [],
    statuses: [],
    sources: [],
    warnings: [],
    generated_at: "2026-04-30T09:00:00.000Z",
  },
  invocation: {
    user_id: "principal_123",
    invocation_type: "preflight",
    task_type: "ask_decode",
    skill_name: "workbench-preflight",
    skill_version: "0.1.0",
    estimated_before_minutes: 30,
    observed_after_minutes: null,
    latency_ms: 500,
    ask_chars: 13,
    status: "succeeded",
    error: null,
    created_at: "2026-04-30T09:00:01.000Z",
  },
  created_at: "2026-04-30T09:00:02.000Z",
};

describe("resumeWorkbenchRun", () => {
  it("loads an owned run, merges context answers, and exposes a staff-safe result", async () => {
    const getRun = vi.fn().mockResolvedValue({ status: "ok", run });
    const saveResume = vi.fn().mockResolvedValue(undefined);

    const result = await resumeWorkbenchRun(
      {
        userId: "principal_123",
        runId: "run-1",
        action: "answer_context",
        answers: {
          "What is the deadline?": "Friday 5pm",
        },
      },
      { getRun, saveResume },
    );

    expect(result).toMatchObject({
      status: "ok",
      resume: {
        run_id: "run-1",
        action: "answer_context",
        status: "resumed",
        context_answers: [
          { question: "What is the deadline?", answer: "Friday 5pm" },
        ],
        unresolved_context: [{ question: "Who signs off?", why: null }],
        warnings: ["Some requested context remains unanswered."],
      },
    });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.resume.workflow.current_stage).toBe("context_needed");
    expect(result.resume.workflow.missing_required_context_count).toBe(1);
    expect(getRun).toHaveBeenCalledWith({
      userId: "principal_123",
      id: "run-1",
    });
    expect(saveResume).toHaveBeenCalledWith({
      userId: "principal_123",
      run,
      resume: (result as Extract<WorkbenchResumeResult, { status: "ok" }>).resume,
    });
  });

  it("continues with deterministic assumptions for unanswered context", async () => {
    const result = await resumeWorkbenchRun(
      {
        userId: "principal_123",
        runId: "run-1",
        action: "continue_with_assumptions",
        answers: [{ question: "What is the deadline?", answer: "Friday 5pm" }],
      },
      { getRun: vi.fn().mockResolvedValue({ status: "ok", run }) },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.resume.context_answers).toEqual([
      { question: "What is the deadline?", answer: "Friday 5pm" },
      {
        question: "Who signs off?",
        answer: "Continue with available context and clearly label assumptions.",
      },
    ]);
    expect(result.resume.unresolved_context).toEqual([]);
    expect(result.resume.workflow.current_stage).toBe("gather");
    expect(result.resume.workflow.using_assumptions).toBe(true);
    expect(result.resume.warnings).toEqual([
      "Continuing with available context and labelled assumptions.",
    ]);
  });

  it("accepts workflow question ids and returns staff-readable labels", async () => {
    const [deadlineQuestion] = deriveWorkbenchContextQuestions(run.result);
    const result = await resumeWorkbenchRun(
      {
        userId: "principal_123",
        runId: "run-1",
        action: "answer_context",
        answers: { [deadlineQuestion.id]: "Friday 5pm" },
      },
      { getRun: vi.fn().mockResolvedValue({ status: "ok", run }) },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.resume.context_answers).toEqual([
      { question: "What is the deadline?", answer: "Friday 5pm" },
    ]);
    expect(result.resume.workflow.current_stage).toBe("context_needed");
  });

  it("stops the run without inventing answers", async () => {
    const result = await resumeWorkbenchRun(
      {
        userId: "principal_123",
        runId: "run-1",
        action: "stop_run",
        answers: [{ question: "What is the deadline?", answer: "Friday 5pm" }],
      },
      { getRun: vi.fn().mockResolvedValue({ status: "ok", run }) },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.resume).toMatchObject({
      run_id: "run-1",
      action: "stop_run",
      status: "stopped",
      context_answers: [{ question: "What is the deadline?", answer: "Friday 5pm" }],
      unresolved_context: run.result.missing_context,
      warnings: ["Run stopped by staff."],
    });
  });

  it("returns a staff-safe not found result for missing runs", async () => {
    const result = await resumeWorkbenchRun(
      {
        userId: "principal_123",
        runId: "missing-run",
        action: "answer_context",
        answers: [],
      },
      { getRun: vi.fn().mockResolvedValue({ status: "ok", run: null }) },
    );

    expect(result).toEqual({
      status: "not_found",
      error: "workbench_run_not_found",
    });
  });
});
