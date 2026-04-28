import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  fetchPendingApprovalRows: vi.fn(),
  persistApprovalRequested: vi.fn(),
  persistApprovalResolved: vi.fn(),
}));

vi.mock("@/lib/workforce/persistence", () => persistence);

interface ApprovalGlobals {
  __wf_pending?: Map<string, unknown>;
  __wf_approvals_rehydrated?: boolean;
  __wf_approvals_rehydrate_promise?: Promise<void>;
}

async function loadApprovals() {
  vi.resetModules();
  const g = globalThis as typeof globalThis & ApprovalGlobals;
  g.__wf_pending = undefined;
  g.__wf_approvals_rehydrated = undefined;
  g.__wf_approvals_rehydrate_promise = undefined;
  return import("@/lib/workforce/approvals");
}

function row(overrides: Partial<PendingApprovalRow> = {}): PendingApprovalRow {
  return {
    id: "approval-1",
    task_id: "task-1",
    agent_id: "ada",
    tool_name: "steward_apply",
    tool_args: { key: "co_fact" },
    preview: "Apply Cornerstone fact",
    detail: { namespace: "aiops" },
    principal_id: "principal-1",
    created_at: "2026-04-26T10:00:00.000Z",
    ...overrides,
  };
}

interface PendingApprovalRow {
  id: string;
  task_id: string;
  agent_id: string;
  tool_name: string;
  tool_args: Record<string, unknown> | null;
  preview: string | null;
  detail: unknown;
  principal_id: string;
  created_at: string;
}

beforeEach(() => {
  persistence.fetchPendingApprovalRows.mockReset();
  persistence.persistApprovalRequested.mockReset();
  persistence.persistApprovalResolved.mockReset();
  persistence.persistApprovalResolved.mockResolvedValue(true);
});

describe("workforce approval cold-start rehydration", () => {
  it("lists pending approval rows from persistence after a cold start", async () => {
    persistence.fetchPendingApprovalRows.mockResolvedValue([
      row({ id: "approval-1", principal_id: "principal-1" }),
      row({
        id: "approval-2",
        task_id: "task-2",
        principal_id: "principal-1",
        created_at: "2026-04-26T09:00:00.000Z",
      }),
      row({ id: "other-principal", principal_id: "principal-2" }),
    ]);
    const approvals = await loadApprovals();

    const pending = await approvals.listPendingApprovals("principal-1");

    expect(pending.map((approval) => approval.approvalId)).toEqual([
      "approval-2",
      "approval-1",
    ]);
    expect(pending[0]).toMatchObject({
      taskId: "task-2",
      agentId: "ada",
      toolName: "steward_apply",
      input: { key: "co_fact" },
      ownerPrincipalId: "principal-1",
    });
  });

  it("keeps stale approvals pending for operator review", async () => {
    persistence.fetchPendingApprovalRows.mockResolvedValue([
      row({ created_at: "2026-04-20T10:00:00.000Z" }),
    ]);
    const approvals = await loadApprovals();

    const pending = await approvals.listPendingApprovals("principal-1");

    expect(pending).toHaveLength(1);
    expect(persistence.persistApprovalResolved).not.toHaveBeenCalled();
  });

  it("dedupes concurrent rehydration in one process", async () => {
    persistence.fetchPendingApprovalRows.mockResolvedValue([row()]);
    const approvals = await loadApprovals();

    await Promise.all([
      approvals.listPendingApprovals("principal-1"),
      approvals.listPendingApprovals("principal-1"),
    ]);

    expect(persistence.fetchPendingApprovalRows).toHaveBeenCalledTimes(1);
  });

  it("resolves rehydrated orphan approvals by updating persistence without resuming a promise", async () => {
    persistence.fetchPendingApprovalRows.mockResolvedValue([row()]);
    const approvals = await loadApprovals();

    const ok = await approvals.resolveApproval(
      "approval-1",
      {
        approved: false,
        reason: "operator_rejected",
        resolvedBy: "principal-1",
      },
      "principal-1",
    );

    expect(ok).toBe(true);
    expect(persistence.persistApprovalResolved).toHaveBeenCalledWith(
      "approval-1",
      {
        approved: false,
        reason: "operator_rejected",
        resolvedBy: "principal-1",
      },
    );
    await expect(approvals.listPendingApprovals("principal-1")).resolves.toEqual(
      [],
    );
  });

  it("preserves live approval promise resolution for existing in-process approvals", async () => {
    persistence.fetchPendingApprovalRows.mockResolvedValue([]);
    const approvals = await loadApprovals();
    const requestApproval = approvals.makeApprovalHook({
      taskId: "task-live",
      agentId: "ada",
      ownerPrincipalId: "principal-1",
    });

    const decisionPromise = requestApproval({
      toolName: "steward_apply",
      preview: "Apply fact",
      input: { key: "co_live" },
    });
    const [pending] = await approvals.listPendingApprovals("principal-1");

    await expect(
      approvals.resolveApproval(
        pending.approvalId,
        { approved: true, resolvedBy: "principal-1" },
        "principal-1",
      ),
    ).resolves.toBe(true);
    await expect(decisionPromise).resolves.toEqual({
      approved: true,
      resolvedBy: "principal-1",
    });
  });

  it("does not strand a live approval promise when persistence cannot claim the row", async () => {
    persistence.fetchPendingApprovalRows.mockResolvedValue([]);
    persistence.persistApprovalResolved.mockResolvedValue(false);
    const approvals = await loadApprovals();
    const requestApproval = approvals.makeApprovalHook({
      taskId: "task-live",
      agentId: "ada",
      ownerPrincipalId: "principal-1",
    });

    const decisionPromise = requestApproval({
      toolName: "steward_apply",
      preview: "Apply fact",
      input: { key: "co_live" },
    });
    const [pending] = await approvals.listPendingApprovals("principal-1");

    await expect(
      approvals.resolveApproval(
        pending.approvalId,
        { approved: true, resolvedBy: "principal-1" },
        "principal-1",
      ),
    ).resolves.toBe(true);
    await expect(decisionPromise).resolves.toEqual({
      approved: true,
      resolvedBy: "principal-1",
    });
  });

  it("cancels rehydrated approvals for a stranded task", async () => {
    persistence.fetchPendingApprovalRows.mockResolvedValue([
      row({ id: "approval-1", task_id: "task-stranded" }),
      row({ id: "approval-2", task_id: "task-stranded" }),
      row({ id: "approval-3", task_id: "other-task" }),
    ]);
    const approvals = await loadApprovals();

    const cancelled = await approvals.cancelPendingApprovalsForTask(
      "task-stranded",
      "principal-1",
    );

    expect(cancelled).toBe(2);
    expect(persistence.persistApprovalResolved).toHaveBeenCalledTimes(2);
    expect(persistence.persistApprovalResolved).toHaveBeenCalledWith(
      "approval-1",
      expect.objectContaining({
        approved: false,
        state: "cancelled",
        reason: "task_cancelled",
      }),
    );
  });
});
