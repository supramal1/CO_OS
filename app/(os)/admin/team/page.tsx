"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adminFetch } from "@/lib/admin-api";
import type { AdminStatus, Invitation, Principal } from "@/lib/admin-types";
import { useAdminWorkspace } from "@/components/admin/workspace-selector";
import { StatusPill } from "@/components/admin/status-pill";
import { TabBar } from "@/components/admin/tab-bar";
import { BulkBar } from "@/components/admin/bulk-bar";
import {
  buildInvitationRequest,
  initialInviteWorkspaceSelection,
  isRoleInvitableFromAdminPanel,
} from "@/components/admin/invite-state";
import {
  Empty,
  Field,
  Modal,
  ModalFooter,
  Toast,
  modalInputStyle,
} from "@/components/admin/modal";

type TabId = "active" | "pending" | "service";

type LoadState =
  | { status: "loading" }
  | {
      status: "loaded";
      principals: Principal[];
      invitations: Invitation[];
      invitationError: string | null;
      admin: AdminStatus | null;
    }
  | { status: "error"; message: string };

const ROLE_OPTIONS: Array<{ value: string; label: string; description: string }> =
  [
    {
      value: "staff",
      label: "Staff",
      description: "Read and write in assigned workspaces.",
    },
    {
      value: "workspace_admin",
      label: "Workspace admin",
      description: "Manage assigned workspaces and invite users.",
    },
    {
      value: "super_admin",
      label: "Super admin",
      description: "Full system access across all workspaces.",
    },
    {
      value: "viewer",
      label: "Viewer",
      description: "Read-only access to specified workspaces.",
    },
  ];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label]),
);

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatRelative(iso: string) {
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return "Expired";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days`;
}

export default function AdminTeamPage() {
  const { selectedWorkspace, workspaces } = useAdminWorkspace();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [tab, setTab] = useState<TabId>("active");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = async () => {
    if (!selectedWorkspace) return;
    setState({ status: "loading" });
    try {
      const principalsPath = showArchived
        ? "/admin/principals?include_archived=true"
        : "/admin/principals";
      const [admin, principals, invitationsResult] = await Promise.all([
        adminFetch<AdminStatus>("/admin/status", {
          namespace: selectedWorkspace,
        }).catch(() => null),
        adminFetch<Principal[]>(principalsPath, { namespace: selectedWorkspace }),
        adminFetch<Invitation[]>("/admin/invitations", {
          namespace: selectedWorkspace,
        })
          .then((invitations) => ({
            invitations,
            invitationError: null as string | null,
          }))
          .catch((err) => ({
            invitations: [] as Invitation[],
            invitationError:
              err instanceof Error ? err.message : "invitations unavailable",
          })),
      ]);
      setState({
        status: "loaded",
        admin,
        principals,
        invitations: invitationsResult.invitations,
        invitationError: invitationsResult.invitationError,
      });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "failed to load",
      });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived, selectedWorkspace]);

  // Reset selection when switching tabs (different bulk action sets)
  useEffect(() => {
    setSelected(new Set());
  }, [tab]);

  const principals = state.status === "loaded" ? state.principals : [];
  const invitations = state.status === "loaded" ? state.invitations : [];
  const invitationError =
    state.status === "loaded" ? state.invitationError : null;

  const activePrincipals = useMemo(
    () =>
      principals.filter(
        (p) =>
          p.type !== "service" &&
          (showArchived ||
            (p.status !== "archived" && p.status !== "deleted")),
      ),
    [principals, showArchived],
  );

  const pendingInvitations = useMemo(
    () => invitations.filter((i) => i.status === "pending"),
    [invitations],
  );

  const servicePrincipals = useMemo(
    () =>
      principals.filter(
        (p) =>
          p.type === "service" &&
          (showArchived ||
            (p.status !== "archived" && p.status !== "deleted")),
      ),
    [principals, showArchived],
  );

  const counts: Record<TabId, number> = {
    active: principals.filter(
      (p) =>
        p.type !== "service" && p.status !== "archived" && p.status !== "deleted",
    ).length,
    pending: pendingInvitations.length,
    service: principals.filter(
      (p) =>
        p.type === "service" && p.status !== "archived" && p.status !== "deleted",
    ).length,
  };

  const tabs: ReadonlyArray<{ id: TabId; label: string; count: number }> = [
    { id: "active", label: "Active", count: counts.active },
    { id: "pending", label: "Pending", count: counts.pending },
    { id: "service", label: "Service", count: counts.service },
  ];

  const filteredActive = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activePrincipals.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [activePrincipals, search]);

  const filteredPending = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pendingInvitations.filter((i) =>
      q ? i.email.toLowerCase().includes(q) : true,
    );
  }, [pendingInvitations, search]);

  const filteredService = useMemo(() => {
    const q = search.trim().toLowerCase();
    return servicePrincipals.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [servicePrincipals, search]);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const currentSelectableIds: string[] =
    tab === "active"
      ? filteredActive
          .filter((p) => p.status !== "archived" && p.status !== "deleted")
          .map((p) => p.id)
      : tab === "pending"
        ? filteredPending.map((i) => i.id)
        : filteredService
            .filter((p) => p.status !== "archived" && p.status !== "deleted")
            .map((p) => p.id);

  const allCurrentSelected =
    currentSelectableIds.length > 0 &&
    currentSelectableIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allCurrentSelected) setSelected(new Set());
    else setSelected(new Set(currentSelectableIds));
  };

  const archivePrincipal = async (id: string) => {
    setActionTarget(id);
    try {
      await adminFetch(`/admin/principals/${id}/status`, {
        method: "PATCH",
        namespace: selectedWorkspace,
        body: JSON.stringify({ status: "archived" }),
      });
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "archive failed");
    } finally {
      setActionTarget(null);
    }
  };

  const bulkArchive = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await adminFetch("/admin/principals/bulk-archive", {
        method: "POST",
        namespace: selectedWorkspace,
        body: JSON.stringify({ principal_ids: Array.from(selected) }),
      });
      setSelected(new Set());
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "bulk archive failed");
    } finally {
      setBusy(false);
    }
  };

  const bulkRevokeKeys = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await adminFetch("/admin/principals/bulk-revoke", {
        method: "POST",
        namespace: selectedWorkspace,
        body: JSON.stringify({ principal_ids: Array.from(selected) }),
      });
      setSelected(new Set());
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "bulk revoke failed");
    } finally {
      setBusy(false);
    }
  };

  const revokeInvitation = async (id: string) => {
    setActionTarget(id);
    try {
      await adminFetch(`/admin/invitations/${id}`, {
        method: "DELETE",
        namespace: selectedWorkspace,
      });
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "revoke failed");
    } finally {
      setActionTarget(null);
    }
  };

  const resendInvitation = async (id: string) => {
    setActionTarget(id);
    try {
      await adminFetch(`/admin/invitations/${id}/resend`, {
        method: "POST",
        namespace: selectedWorkspace,
        body: JSON.stringify({ extend_days: 30 }),
      });
      setToast("Invitation extended by 30 days.");
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "resend failed");
    } finally {
      setActionTarget(null);
    }
  };

  const bulkRevokeInvitations = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          adminFetch(`/admin/invitations/${id}`, {
            method: "DELETE",
            namespace: selectedWorkspace,
          }).catch(() => null),
        ),
      );
      setSelected(new Set());
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "bulk revoke failed");
    } finally {
      setBusy(false);
    }
  };

  const onInviteCreated = async () => {
    setInviteOpen(false);
    setTab("pending");
    await load();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "calc(100vh - var(--shell-h) - 44px)",
      }}
    >
      <Header
        admin={state.status === "loaded" ? state.admin : null}
        counts={counts}
        inviteDisabled={Boolean(invitationError)}
        onInvite={() => setInviteOpen(true)}
      />

      <TabBar<TabId> tabs={tabs} activeId={tab} onChange={setTab} />

      <Toolbar
        tab={tab}
        search={search}
        setSearch={setSearch}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
        allCurrentSelected={allCurrentSelected}
        toggleAll={toggleAll}
        selectableCount={currentSelectableIds.length}
      />

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {state.status === "loading" ? (
          <Empty>Loading team…</Empty>
        ) : state.status === "error" ? (
          <Empty>Couldn&rsquo;t load — {state.message}</Empty>
        ) : tab === "active" ? (
          filteredActive.length === 0 ? (
            <Empty>
              {search
                ? "No active members match your search."
                : "No active members yet."}
            </Empty>
          ) : (
            <PrincipalTable
              rows={filteredActive}
              selected={selected}
              onToggle={toggleOne}
              onArchive={archivePrincipal}
              actionTarget={actionTarget}
              showServiceColumn={false}
            />
          )
        ) : tab === "pending" && invitationError ? (
          <Empty>Pending invitations unavailable — {invitationError}</Empty>
        ) : tab === "pending" ? (
          filteredPending.length === 0 ? (
            <Empty>
              {search
                ? "No pending invitations match your search."
                : "No pending invitations."}
            </Empty>
          ) : (
            <InvitationTable
              rows={filteredPending}
              selected={selected}
              onToggle={toggleOne}
              onResend={resendInvitation}
              onRevoke={revokeInvitation}
              actionTarget={actionTarget}
            />
          )
        ) : filteredService.length === 0 ? (
          <Empty>
            {search
              ? "No service principals match your search."
              : "No service principals yet."}
          </Empty>
        ) : (
          <PrincipalTable
            rows={filteredService}
            selected={selected}
            onToggle={toggleOne}
            onArchive={archivePrincipal}
            actionTarget={actionTarget}
            showServiceColumn={true}
          />
        )}
      </div>

      <BulkBar
        selectedCount={selected.size}
        itemNoun={tab === "pending" ? "invitation" : tab === "service" ? "service" : "user"}
        onClear={() => setSelected(new Set())}
        actions={
          tab === "active"
            ? [
                {
                  label: busy ? "Archiving…" : "Archive",
                  onClick: bulkArchive,
                  tone: "danger",
                  disabled: busy,
                },
              ]
            : tab === "pending"
              ? [
                  {
                    label: busy ? "Revoking…" : "Revoke",
                    onClick: bulkRevokeInvitations,
                    tone: "danger",
                    disabled: busy,
                  },
                ]
              : [
                  {
                    label: busy ? "Revoking…" : "Revoke keys",
                    onClick: bulkRevokeKeys,
                    tone: "danger",
                    disabled: busy,
                  },
                  {
                    label: busy ? "Archiving…" : "Archive",
                    onClick: bulkArchive,
                    tone: "danger",
                    disabled: busy,
                  },
                ]
        }
      />

      {inviteOpen ? (
        <InviteDialog
          namespace={selectedWorkspace}
          workspaces={workspaces}
          onClose={() => setInviteOpen(false)}
          onCreated={onInviteCreated}
          onError={(m) => setToast(m)}
        />
      ) : null}

      {toast ? (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      ) : null}
    </div>
  );
}

function Header({
  admin,
  counts,
  inviteDisabled,
  onInvite,
}: {
  admin: AdminStatus | null;
  counts: Record<TabId, number>;
  inviteDisabled: boolean;
  onInvite: () => void;
}) {
  return (
    <header
      style={{
        padding: "20px 28px 16px",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
          }}
        >
          Admin · team
        </div>
        <h1
          style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-plex-serif)",
            fontWeight: 400,
            fontSize: 26,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
          }}
        >
          Team
        </h1>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          color: "var(--ink-dim)",
          letterSpacing: "0.04em",
        }}
      >
        <span>
          <span style={{ color: "var(--ink)" }}>{counts.active}</span> active
        </span>
        <span style={{ color: "var(--ink-faint)" }}>·</span>
        <span>
          <span style={{ color: "var(--ink)" }}>{counts.pending}</span> pending
        </span>
        <span style={{ color: "var(--ink-faint)" }}>·</span>
        <span>
          <span style={{ color: "var(--ink)" }}>{counts.service}</span> service
        </span>
        {admin ? (
          <>
            <span style={{ color: "var(--ink-faint)" }}>·</span>
            <span>
              <span style={{ color: "var(--ink)" }}>
                {admin.namespace_count}
              </span>{" "}
              workspaces
            </span>
          </>
        ) : null}
      </div>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onInvite}
        disabled={inviteDisabled}
        title={inviteDisabled ? "Pending invitations unavailable" : undefined}
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "6px 12px",
          background: "var(--ink)",
          color: "var(--panel)",
          border: "1px solid var(--ink)",
          cursor: inviteDisabled ? "not-allowed" : "pointer",
          opacity: inviteDisabled ? 0.5 : 1,
        }}
      >
        Invite member
      </button>
    </header>
  );
}

function Toolbar({
  tab,
  search,
  setSearch,
  showArchived,
  setShowArchived,
  allCurrentSelected,
  toggleAll,
  selectableCount,
}: {
  tab: TabId;
  search: string;
  setSearch: (s: string) => void;
  showArchived: boolean;
  setShowArchived: (b: boolean) => void;
  allCurrentSelected: boolean;
  toggleAll: () => void;
  selectableCount: number;
}) {
  return (
    <div
      style={{
        padding: "10px 28px",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: selectableCount > 0 ? "pointer" : "default",
          opacity: selectableCount > 0 ? 1 : 0.5,
        }}
      >
        <input
          type="checkbox"
          checked={allCurrentSelected}
          disabled={selectableCount === 0}
          onChange={toggleAll}
        />
        <span
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--ink-dim)",
          }}
        >
          Select all
        </span>
      </label>

      {tab !== "pending" ? (
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          <span
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-dim)",
            }}
          >
            Show archived
          </span>
        </label>
      ) : null}

      <input
        type="text"
        placeholder={
          tab === "pending" ? "Search by email…" : "Search by name or email…"
        }
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          flex: 1,
          padding: "6px 10px",
          fontFamily: "var(--font-plex-sans)",
          fontSize: 13,
          color: "var(--ink)",
          background: "var(--panel)",
          border: "1px solid var(--rule)",
        }}
      />
    </div>
  );
}

function PrincipalTable({
  rows,
  selected,
  onToggle,
  onArchive,
  actionTarget,
  showServiceColumn,
}: {
  rows: Principal[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onArchive: (id: string) => void;
  actionTarget: string | null;
  showServiceColumn: boolean;
}) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: "var(--font-plex-sans)",
        fontSize: 13,
      }}
    >
      <thead>
        <tr
          style={{
            position: "sticky",
            top: 0,
            background: "var(--bg)",
            zIndex: 1,
          }}
        >
          <Th style={{ width: 36 }}> </Th>
          <Th>Name</Th>
          <Th>Email</Th>
          {showServiceColumn ? <Th>Type</Th> : null}
          <Th>Status</Th>
          <Th>Created</Th>
          <Th style={{ width: 140, textAlign: "right" }}>Actions</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const archived = p.status === "archived" || p.status === "deleted";
          const isSelected = selected.has(p.id);
          return (
            <tr
              key={p.id}
              style={{
                borderBottom: "1px solid var(--rule)",
                background: isSelected ? "var(--panel-2)" : "transparent",
                opacity: archived ? 0.55 : 1,
              }}
            >
              <Td>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(p.id)}
                  disabled={archived}
                />
              </Td>
              <Td>
                <Link
                  href={`/admin/team/${p.id}`}
                  style={{ color: "var(--ink)", fontWeight: 500 }}
                >
                  {p.name}
                </Link>
                {p._grant_count != null || p._credential_count != null ? (
                  <div
                    style={{
                      marginTop: 2,
                      fontFamily: "var(--font-plex-mono)",
                      fontSize: 11,
                      color: "var(--ink-faint)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {p._grant_count != null ? `${p._grant_count} ws` : ""}
                    {p._grant_count != null && p._credential_count != null
                      ? " · "
                      : ""}
                    {p._credential_count != null
                      ? `${p._credential_count} key${p._credential_count !== 1 ? "s" : ""}`
                      : ""}
                  </div>
                ) : null}
              </Td>
              <Td>
                <span style={{ color: "var(--ink-dim)" }}>{p.email ?? "—"}</span>
              </Td>
              {showServiceColumn ? (
                <Td>
                  <span
                    style={{
                      fontFamily: "var(--font-plex-mono)",
                      fontSize: 11,
                      color: "var(--ink-dim)",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {p.type}
                  </span>
                </Td>
              ) : null}
              <Td>
                <StatusPill status={p.status} />
              </Td>
              <Td>
                <span style={{ color: "var(--ink-dim)" }}>
                  {formatDate(p.created_at)}
                </span>
              </Td>
              <Td style={{ textAlign: "right" }}>
                {!archived ? (
                  <RowAction
                    tone="warn"
                    onClick={() => onArchive(p.id)}
                    disabled={actionTarget === p.id}
                  >
                    {actionTarget === p.id ? "Archiving…" : "Archive"}
                  </RowAction>
                ) : (
                  <span
                    style={{
                      fontFamily: "var(--font-plex-mono)",
                      fontSize: 10,
                      color: "var(--ink-faint)",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                    }}
                  >
                    —
                  </span>
                )}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function InvitationTable({
  rows,
  selected,
  onToggle,
  onResend,
  onRevoke,
  actionTarget,
}: {
  rows: Invitation[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
  actionTarget: string | null;
}) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: "var(--font-plex-sans)",
        fontSize: 13,
      }}
    >
      <thead>
        <tr
          style={{
            position: "sticky",
            top: 0,
            background: "var(--bg)",
            zIndex: 1,
          }}
        >
          <Th style={{ width: 36 }}> </Th>
          <Th>Email</Th>
          <Th>Role</Th>
          <Th>Workspaces</Th>
          <Th>Expires</Th>
          <Th style={{ width: 200, textAlign: "right" }}>Actions</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((inv) => {
          const isSelected = selected.has(inv.id);
          const expired = new Date(inv.expires_at) < new Date();
          return (
            <tr
              key={inv.id}
              style={{
                borderBottom: "1px solid var(--rule)",
                background: isSelected ? "var(--panel-2)" : "transparent",
              }}
            >
              <Td>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(inv.id)}
                />
              </Td>
              <Td>
                <span style={{ color: "var(--ink)", fontWeight: 500 }}>
                  {inv.email}
                </span>
                {inv.notes ? (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 12,
                      color: "var(--ink-dim)",
                      maxWidth: 460,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {inv.notes}
                  </div>
                ) : null}
              </Td>
              <Td>
                <span style={{ color: "var(--ink-dim)" }}>
                  {ROLE_LABEL[inv.role_template] ?? inv.role_template}
                </span>
              </Td>
              <Td>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {inv.namespace_grants.length === 0 ? (
                    <span style={{ color: "var(--ink-faint)" }}>—</span>
                  ) : (
                    inv.namespace_grants.map((g) => (
                      <span
                        key={g.namespace}
                        style={{
                          fontFamily: "var(--font-plex-mono)",
                          fontSize: 10,
                          letterSpacing: "0.08em",
                          padding: "2px 6px",
                          color: "var(--ink-dim)",
                          border: "1px solid var(--rule)",
                        }}
                      >
                        {g.namespace}
                      </span>
                    ))
                  )}
                </div>
              </Td>
              <Td>
                <span
                  style={{
                    color: expired ? "var(--c-forge)" : "var(--ink-dim)",
                    fontFamily: "var(--font-plex-mono)",
                    fontSize: 11,
                    letterSpacing: "0.04em",
                  }}
                >
                  {formatRelative(inv.expires_at)}
                </span>
              </Td>
              <Td style={{ textAlign: "right" }}>
                <div
                  style={{
                    display: "inline-flex",
                    gap: 8,
                    justifyContent: "flex-end",
                  }}
                >
                  <RowAction
                    onClick={() => onResend(inv.id)}
                    disabled={actionTarget === inv.id}
                  >
                    {actionTarget === inv.id ? "…" : "Resend"}
                  </RowAction>
                  <RowAction
                    tone="danger"
                    onClick={() => onRevoke(inv.id)}
                    disabled={actionTarget === inv.id}
                  >
                    Revoke
                  </RowAction>
                </div>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Th({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 12px",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--ink-faint)",
        fontWeight: 400,
        borderBottom: "1px solid var(--rule)",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <td style={{ padding: "12px 12px", verticalAlign: "middle", ...style }}>
      {children}
    </td>
  );
}

function RowAction({
  children,
  onClick,
  tone = "default",
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "warn" | "danger";
  disabled?: boolean;
}) {
  const color =
    tone === "danger"
      ? "var(--c-forge)"
      : tone === "warn"
        ? "var(--c-cookbook)"
        : "var(--ink)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        padding: "4px 8px",
        border: `1px solid ${color}`,
        background: "transparent",
        color,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function InviteDialog({
  namespace,
  workspaces,
  onClose,
  onCreated,
  onError,
}: {
  namespace: string | null;
  workspaces: string[];
  onClose: () => void;
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [pronouns, setPronouns] = useState("they/them");
  const [jobTitle, setJobTitle] = useState("");
  const [organization, setOrganization] = useState("Charlie Oscar");
  const [teams, setTeams] = useState("");
  const [selectedNs, setSelectedNs] = useState<Set<string>>(() =>
    initialInviteWorkspaceSelection(workspaces, namespace),
  );
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelectedNs(initialInviteWorkspaceSelection(workspaces, namespace));
  }, [namespace, workspaces]);

  const toggleNs = (name: string) => {
    setSelectedNs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = async () => {
    if (!email.trim() || selectedNs.size === 0) return;
    setBusy(true);
    try {
      await adminFetch("/admin/invitations", {
        method: "POST",
        namespace,
        body: JSON.stringify(
          buildInvitationRequest({
            email,
            role,
            namespaces: Array.from(selectedNs),
            notes,
            pronouns,
            jobTitle,
            organization,
            teams,
          }),
        ),
      });
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "invite failed");
    } finally {
      setBusy(false);
    }
  };

  const roleDescription = ROLE_OPTIONS.find((r) => r.value === role)?.description;

  return (
    <Modal title="Invite member" onClose={onClose} width={560}>
      <Field label="Email">
        <input
          autoFocus
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@example.com"
          style={modalInputStyle}
        />
      </Field>

      <Field label="Role">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          style={modalInputStyle}
        >
          {ROLE_OPTIONS.map((r) => (
            isRoleInvitableFromAdminPanel(r.value) ? (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ) : null
          ))}
        </select>
        {roleDescription ? (
          <span
            style={{
              fontFamily: "var(--font-plex-sans)",
              fontSize: 12,
              color: "var(--ink-dim)",
              marginTop: 4,
            }}
          >
            {roleDescription}
          </span>
        ) : null}
      </Field>

      <Field label="Pronouns">
        <select
          value={pronouns}
          onChange={(e) => setPronouns(e.target.value)}
          style={modalInputStyle}
        >
          <option value="they/them">they/them</option>
          <option value="she/her">she/her</option>
          <option value="he/him">he/him</option>
        </select>
      </Field>

      <Field label="Job title">
        <input
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="e.g. Head of AI Ops"
          style={modalInputStyle}
        />
      </Field>

      <Field label="Organization">
        <input
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          placeholder="Charlie Oscar"
          style={modalInputStyle}
        />
      </Field>

      <Field label="Teams (comma-separated slugs)">
        <input
          value={teams}
          onChange={(e) => setTeams(e.target.value)}
          placeholder="e.g. innovation, product"
          style={modalInputStyle}
        />
      </Field>

      <Field label="Workspaces (required)">
        {workspaces.length === 0 ? (
          <span
            style={{
              fontFamily: "var(--font-plex-sans)",
              fontSize: 13,
              color: "var(--ink-dim)",
            }}
          >
            Loading workspaces…
          </span>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxHeight: 180,
              overflowY: "auto",
              border: "1px solid var(--rule)",
              padding: 8,
              background: "var(--bg)",
            }}
          >
            {workspaces.map((workspace) => (
              <label
                key={workspace}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 4px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedNs.has(workspace)}
                  onChange={() => toggleNs(workspace)}
                />
                <span
                  style={{
                    fontFamily: "var(--font-plex-sans)",
                    fontSize: 13,
                    color: "var(--ink)",
                  }}
                >
                  {workspace}
                </span>
              </label>
            ))}
          </div>
        )}
      </Field>

      <Field label="Notes (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Why are they being invited?"
          style={{
            ...modalInputStyle,
            resize: "vertical",
            fontFamily: "var(--font-plex-sans)",
          }}
        />
      </Field>

      <ModalFooter
        primaryLabel={busy ? "Sending…" : "Send invitation"}
        primaryDisabled={busy || !email.trim() || selectedNs.size === 0}
        onPrimary={submit}
        onCancel={onClose}
      />
    </Modal>
  );
}
