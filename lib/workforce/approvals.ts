// Approval registry — Path Y from the WF-6 design.
//
// The substrate's tool dispatcher calls `requestApproval` and awaits a Promise.
// That Promise is registered here, keyed by an opaque approvalId. The inbox
// API resolves it when an operator clicks approve / reject. Until then, the
// agent's invocation loop is parked on `await dispatch(...)` — no checkpoint,
// no resume. The closure (messages array, AbortSignal, EventLog) stays alive
// in the runner's running task because the substrate is in-memory synchronous.
//
// Constraints inherited from the design:
//   - Live Promise resolution is process-local. A Vercel cold start destroys
//     the suspended Promise and invocation closure.
//   - Pending rows in tool_approvals are rehydrated as orphaned approvals so
//     operators can clear the durable inbox honestly; resolving an orphan does
//     not resume the lost invocation.
//   - No timeout in v0. Operators close the panel by deciding.

import { randomUUID } from "node:crypto";
import type { ApprovalDecision, ApprovalRequest } from "@workforce/substrate";
import {
  fetchPendingApprovalRows,
  persistApprovalRequested,
  persistApprovalResolved,
  type PendingApprovalRow,
} from "./persistence";

export interface PendingApproval {
  approvalId: string;
  taskId: string;
  agentId: string;
  toolName: string;
  preview: string;
  detail?: unknown;
  input: Record<string, unknown>;
  createdAt: string;
  ownerPrincipalId: string;
}

interface DeferredApproval {
  pending: PendingApproval;
  source: "live" | "rehydrated_orphan";
  resolve?: (decision: ApprovalDecision) => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __wf_pending: Map<string, DeferredApproval> | undefined;
  // eslint-disable-next-line no-var
  var __wf_approvals_rehydrated: boolean | undefined;
  // eslint-disable-next-line no-var
  var __wf_approvals_rehydrate_promise: Promise<void> | undefined;
}

const PENDING: Map<string, DeferredApproval> =
  (globalThis.__wf_pending ??= new Map());

interface RegisterContext {
  taskId: string;
  agentId: string;
  ownerPrincipalId: string;
}

/**
 * Build a substrate-compatible `requestApproval` hook bound to a given
 * task's owner. The runner mints one per invocation (closing over the
 * principal so we can authorise approve/reject calls) and threads it
 * into `InvocationOptions.requestApproval`.
 *
 * The returned Promise resolves when an operator approves/rejects via
 * the inbox API. It never rejects — a refusal arrives as
 * `{ approved: false, reason }`.
 */
export function makeApprovalHook(ctx: RegisterContext) {
  return async (req: ApprovalRequest): Promise<ApprovalDecision> => {
    const approvalId = randomUUID();
    const createdAt = new Date().toISOString();
    const pending: PendingApproval = {
      approvalId,
      taskId: ctx.taskId,
      agentId: ctx.agentId,
      toolName: req.toolName,
      preview: req.preview,
      detail: req.detail,
      input: req.input,
      createdAt,
      ownerPrincipalId: ctx.ownerPrincipalId,
    };
    const decisionPromise = new Promise<ApprovalDecision>((resolve) => {
      PENDING.set(approvalId, { pending, source: "live", resolve });
    });
    // Persist alongside the in-memory entry so the inbox UI can rebuild
    // pending state after a process restart and so audit history survives.
    void persistApprovalRequested(pending);
    return decisionPromise;
  };
}

/**
 * Resolve a pending approval. Returns `false` when the id is unknown or
 * the principal isn't the owner — both surface as a 404 to avoid leaking
 * existence across principals.
 */
export async function resolveApproval(
  approvalId: string,
  decision: ApprovalDecision,
  principalId: string,
): Promise<boolean> {
  await ensureApprovalsRehydrated();
  const entry = PENDING.get(approvalId);
  if (!entry) return false;
  if (entry.pending.ownerPrincipalId !== principalId) return false;
  if (entry.source === "live") {
    PENDING.delete(approvalId);
    void persistApprovalResolved(approvalId, decision);
    entry.resolve?.(decision);
    return true;
  }
  const persisted = await persistApprovalResolved(approvalId, decision);
  if (!persisted) return false;
  PENDING.delete(approvalId);
  entry.resolve?.(decision);
  return true;
}

export async function listPendingApprovals(
  principalId: string,
): Promise<PendingApproval[]> {
  await ensureApprovalsRehydrated();
  const out: PendingApproval[] = [];
  for (const entry of PENDING.values()) {
    if (entry.pending.ownerPrincipalId !== principalId) continue;
    out.push(entry.pending);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function getPendingApproval(
  approvalId: string,
  principalId: string,
): Promise<PendingApproval | null> {
  await ensureApprovalsRehydrated();
  const entry = PENDING.get(approvalId);
  if (!entry) return null;
  if (entry.pending.ownerPrincipalId !== principalId) return null;
  return entry.pending;
}

export async function cancelPendingApprovalsForTask(
  taskId: string,
  principalId: string,
): Promise<number> {
  await ensureApprovalsRehydrated();
  const matches = [...PENDING.entries()].filter(
    ([, entry]) =>
      entry.pending.taskId === taskId &&
      entry.pending.ownerPrincipalId === principalId,
  );
  const resolved = await Promise.all(
    matches.map(async ([approvalId, entry]) => {
      const decision: ApprovalDecision = {
        approved: false,
        state: "cancelled",
        reason: "task_cancelled",
        resolvedBy: "system:task_cancelled",
      };
      if (entry.source === "live") {
        PENDING.delete(approvalId);
        void persistApprovalResolved(approvalId, decision);
        entry.resolve?.(decision);
        return true;
      }
      const persisted = await persistApprovalResolved(approvalId, decision);
      if (!persisted) return false;
      PENDING.delete(approvalId);
      entry.resolve?.(decision);
      return true;
    }),
  );
  return resolved.filter(Boolean).length;
}

export async function ensureApprovalsRehydrated(): Promise<void> {
  if (globalThis.__wf_approvals_rehydrated) return;
  if (globalThis.__wf_approvals_rehydrate_promise) {
    return globalThis.__wf_approvals_rehydrate_promise;
  }

  const promise = (async () => {
    const rows = await fetchPendingApprovalRows();
    for (const row of rows) {
      if (PENDING.has(row.id)) continue;
      PENDING.set(row.id, {
        pending: pendingApprovalFromRow(row),
        source: "rehydrated_orphan",
      });
    }
    globalThis.__wf_approvals_rehydrated = true;
  })().finally(() => {
    globalThis.__wf_approvals_rehydrate_promise = undefined;
  });

  globalThis.__wf_approvals_rehydrate_promise = promise;
  return promise;
}

function pendingApprovalFromRow(row: PendingApprovalRow): PendingApproval {
  return {
    approvalId: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    toolName: row.tool_name,
    preview: row.preview ?? `${row.tool_name} approval`,
    detail: row.detail ?? undefined,
    input: inputFromRow(row.tool_args),
    createdAt: row.created_at,
    ownerPrincipalId: row.principal_id,
  };
}

function inputFromRow(input: Record<string, unknown> | null): Record<string, unknown> {
  if (!input || Array.isArray(input) || typeof input !== "object") return {};
  return input;
}
