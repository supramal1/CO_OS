import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resumeWorkbenchRun: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/workbench/resume", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workbench/resume")>();
  return {
    ...actual,
    resumeWorkbenchRun: (...args: unknown[]) =>
      mocks.resumeWorkbenchRun(...args),
  };
});

import { POST } from "@/app/api/workbench/runs/[id]/resume/route";

function request(jsonBody: unknown): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.resumeWorkbenchRun.mockReset();
});

describe("POST /api/workbench/runs/[id]/resume", () => {
  it("resumes an authenticated staff run", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.resumeWorkbenchRun.mockResolvedValue({
      status: "ok",
      resume: {
        run_id: "run-1",
        action: "answer_context",
        status: "resumed",
        context_answers: [
          { question: "What is the deadline?", answer: "Friday 5pm" },
        ],
        unresolved_context: [],
        warnings: [],
      },
    });

    const res = await POST(
      request({
        action: "answer_context",
        answers: { "What is the deadline?": "Friday 5pm" },
      }),
      { params: Promise.resolve({ id: "run-1" }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resume: {
        run_id: "run-1",
        action: "answer_context",
        status: "resumed",
        context_answers: [
          { question: "What is the deadline?", answer: "Friday 5pm" },
        ],
        unresolved_context: [],
        warnings: [],
      },
    });
    expect(mocks.resumeWorkbenchRun).toHaveBeenCalledWith({
      userId: "principal_123",
      runId: "run-1",
      action: "answer_context",
      answers: { "What is the deadline?": "Friday 5pm" },
    });
  });

  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await POST(request({ action: "answer_context" }), {
      params: Promise.resolve({ id: "run-1" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.resumeWorkbenchRun).not.toHaveBeenCalled();
  });

  it("returns staff-safe 404 for a missing run", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    mocks.resumeWorkbenchRun.mockResolvedValue({
      status: "not_found",
      error: "workbench_run_not_found",
    });

    const res = await POST(request({ action: "answer_context" }), {
      params: Promise.resolve({ id: "missing-run" }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "workbench_run_not_found" });
  });
});
