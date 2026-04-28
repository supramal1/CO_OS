import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockSession = vi.hoisted(() => vi.fn());
const runner = vi.hoisted(() => ({
  cancelTask: vi.fn(),
}));
const approvals = vi.hoisted(() => ({
  cancelPendingApprovalsForTask: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: () => mockSession(),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/workforce/runner", () => runner);
vi.mock("@/lib/workforce/approvals", () => approvals);

import { POST } from "@/app/api/workforce/tasks/[id]/cancel/route";

function req(): NextRequest {
  return {} as NextRequest;
}

beforeEach(() => {
  mockSession.mockReset();
  runner.cancelTask.mockReset();
  approvals.cancelPendingApprovalsForTask.mockReset();
  mockSession.mockResolvedValue({
    apiKey: "test-key",
    isAdmin: true,
    principalId: "principal-1",
  });
});

describe("POST /api/workforce/tasks/:id/cancel", () => {
  it("cancels stranded pending approvals even when the task is no longer in the runner registry", async () => {
    runner.cancelTask.mockReturnValue(false);
    approvals.cancelPendingApprovalsForTask.mockResolvedValue(2);

    const res = await POST(req(), { params: { id: "task-stranded" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(approvals.cancelPendingApprovalsForTask).toHaveBeenCalledWith(
      "task-stranded",
      "principal-1",
    );
    expect(body).toEqual({
      ok: true,
      taskId: "task-stranded",
      state: "cancelled",
      cancelledApprovals: 2,
      taskCancelled: false,
    });
  });

  it("still returns 404 when neither the runner task nor approvals exist", async () => {
    runner.cancelTask.mockReturnValue(false);
    approvals.cancelPendingApprovalsForTask.mockResolvedValue(0);

    const res = await POST(req(), { params: { id: "missing-task" } });

    expect(res.status).toBe(404);
  });
});
