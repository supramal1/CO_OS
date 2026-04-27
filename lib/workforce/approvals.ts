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
//   - Process-local: a Vercel cold start drops every pending approval. The
//     parent task transitions to `failed` (the substrate cancels via the
//     AbortSignal on shutdown). Same blast radius as any in-flight task.
//   - Idempotent resolve: double-clicking approve twice is a no-op the
//     second time.
//   - No timeout in v0. Operators close the panel by deciding.

import { randomUUID } from "node:crypto";
import type { ApprovalDecision, ApprovalRequest } from "@workforce/substrate";
import { persistApprovalRequested, persistApprovalResolved } from "./persistence";

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
  resolve: (decision: ApprovalDecision) => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __wf_pending: Map<string, DeferredApproval> | undefined;
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
      PENDING.set(approvalId, { pending, resolve });
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
export function resolveApproval(
  approvalId: string,
  decision: ApprovalDecision,
  principalId: string,
): boolean {
  const entry = PENDING.get(approvalId);
  if (!entry) return false;
  if (entry.pending.ownerPrincipalId !== principalId) return false;
  PENDING.delete(approvalId);
  void persistApprovalResolved(approvalId, decision);
  entry.resolve(decision);
  return true;
}

export function listPendingApprovals(principalId: string): PendingApproval[] {
  const out: PendingApproval[] = [];
  for (const entry of PENDING.values()) {
    if (entry.pending.ownerPrincipalId !== principalId) continue;
    out.push(entry.pending);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export function getPendingApproval(
  approvalId: string,
  principalId: string,
): PendingApproval | null {
  const entry = PENDING.get(approvalId);
  if (!entry) return null;
  if (entry.pending.ownerPrincipalId !== principalId) return null;
  return entry.pending;
}

export async function cancelPendingApprovalsForTask(
  taskId: string,
  principalId: string,
): Promise<number> {
  const matches = [...PENDING.entries()].filter(
    ([, entry]) =>
      entry.pending.taskId === taskId &&
      entry.pending.ownerPrincipalId === principalId,
  );
  await Promise.all(
    matches.map(async ([approvalId, entry]) => {
      const decision: ApprovalDecision = {
        approved: false,
        state: "cancelled",
        reason: "task_cancelled",
        resolvedBy: "system:task_cancelled",
      };
      PENDING.delete(approvalId);
      await persistApprovalResolved(approvalId, decision);
      entry.resolve(decision);
    }),
  );
  return matches.length;
}
