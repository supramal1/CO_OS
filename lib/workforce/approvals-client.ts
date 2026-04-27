// Client-side DTO + fetch helpers for the approval inbox.
//
// The shape mirrors PendingApproval on the server side, but typed
// independently so a future server-side change doesn't silently drift
// the client. The list endpoint already filters to the current
// principal — we just deserialize and pass the array straight through.

export interface PendingApprovalDto {
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

export async function fetchPendingApprovals(): Promise<PendingApprovalDto[]> {
  const res = await fetch("/api/workforce/approvals", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`approvals list failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { approvals: PendingApprovalDto[] };
  return body.approvals ?? [];
}

export async function resolvePendingApproval(
  approvalId: string,
  decision: { approved: boolean; reason?: string },
): Promise<{ ok: true } | { ok: false; status: number }> {
  const res = await fetch(`/api/workforce/approvals/${approvalId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(decision),
  });
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status };
}
