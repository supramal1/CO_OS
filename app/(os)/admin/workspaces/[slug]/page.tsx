"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-api";
import type {
  Namespace,
  Principal,
  NamespaceGrant,
  SetupClientResult,
} from "@/lib/admin-types";
import { StatusPill } from "@/components/admin/status-pill";
import {
  Empty,
  Field,
  Modal,
  ModalFooter,
  Toast,
  modalInputStyle,
} from "@/components/admin/modal";
import { CredentialReveal } from "@/components/admin/credential-reveal";

type MemberRow = { principal: Principal; grant: NamespaceGrant };

type ConnectionRow = {
  principalId: string;
  principalName: string;
  status: string;
  clientType: "claude-code" | "claude-desktop";
  label: string;
};

type DetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      workspace: Namespace;
      members: MemberRow[];
      connections: ConnectionRow[];
    };

const TYPE_LABEL: Record<string, string> = {
  client: "Client",
  client_sub: "Client (sub)",
  internal: "Internal",
  system: "System",
};

const ACCESS_LABEL: Record<string, string> = {
  read: "Read",
  write: "Write",
  admin: "Admin",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function AdminWorkspaceDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const { slug } = params;
  const router = useRouter();

  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<MemberRow | null>(null);
  const [removeConnectionTarget, setRemoveConnectionTarget] = useState<ConnectionRow | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [revealKey, setRevealKey] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [workspace, principals] = await Promise.all([
        adminFetch<Namespace>(`/admin/namespaces/${slug}`, { namespace: slug }),
        adminFetch<Principal[]>("/admin/principals", { namespace: slug }).catch(
          () => [] as Principal[],
        ),
      ]);

      // Resolve each principal's grants → members for this workspace
      const memberResults = await Promise.all(
        principals.map(async (p) => {
          try {
            const grants = await adminFetch<NamespaceGrant[]>(
              `/admin/principals/${p.id}/grants`,
              { namespace: slug },
            );
            const grant = grants.find((g) => g.namespace === slug);
            return grant ? { principal: p, grant } : null;
          } catch {
            return null;
          }
        }),
      );
      const members = memberResults.filter(
        (m): m is MemberRow => m !== null,
      );

      // Connections derived from naming convention
      const connections: ConnectionRow[] = principals
        .map((p) => {
          const m = p.name.match(/^(claude-code|claude-desktop)--(.+)$/);
          if (!m || m[2] !== slug) return null;
          return {
            principalId: p.id,
            principalName: p.name,
            status: p.status,
            clientType: m[1] as "claude-code" | "claude-desktop",
            label:
              m[1] === "claude-code" ? "Claude Code" : "Claude Desktop",
          };
        })
        .filter((c): c is ConnectionRow => c !== null);

      setState({ status: "loaded", workspace, members, connections });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "failed to load",
      });
    }
  }, [slug]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const archive = async () => {
    setBusy(true);
    try {
      await adminFetch(`/admin/namespaces/${slug}`, {
        method: "DELETE",
        namespace: slug,
      });
      router.push("/admin/workspaces");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "archive failed");
    } finally {
      setBusy(false);
      setArchiveOpen(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      await adminFetch<Namespace>(`/admin/namespaces/${slug}`, {
        method: "PATCH",
        namespace: slug,
        body: JSON.stringify({ status: "active" }),
      });
      await loadAll();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "restore failed");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (row: MemberRow) => {
    setBusy(true);
    try {
      await adminFetch(
        `/admin/principals/${row.principal.id}/grants/${row.grant.id}`,
        { method: "DELETE", namespace: slug },
      );
      setState((s) =>
        s.status === "loaded"
          ? {
              ...s,
              members: s.members.filter((m) => m.grant.id !== row.grant.id),
            }
          : s,
      );
      setRemoveMemberTarget(null);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "remove failed");
    } finally {
      setBusy(false);
    }
  };

  const removeConnection = async (conn: ConnectionRow) => {
    setBusy(true);
    try {
      await adminFetch(`/admin/principals/${conn.principalId}/status`, {
        method: "PATCH",
        namespace: slug,
        body: JSON.stringify({ status: "archived" }),
      });
      await adminFetch(`/admin/principals/${conn.principalId}/permanent`, {
        method: "DELETE",
        namespace: slug,
        body: JSON.stringify({ confirmation: conn.principalName }),
      });
      setState((s) =>
        s.status === "loaded"
          ? {
              ...s,
              connections: s.connections.filter(
                (c) => c.principalId !== conn.principalId,
              ),
            }
          : s,
      );
      setRemoveConnectionTarget(null);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "remove failed");
    } finally {
      setBusy(false);
    }
  };

  if (state.status === "loading") {
    return <Empty>Loading workspace…</Empty>;
  }
  if (state.status === "error") {
    return <Empty>Couldn&rsquo;t load — {state.message}</Empty>;
  }

  const { workspace, members, connections } = state;
  const displayName = workspace.display_name || workspace.name;
  const isArchived = workspace.status !== "active";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "calc(100vh - var(--shell-h) - 44px)",
        overflowY: "auto",
      }}
    >
      <Hero
        workspace={workspace}
        memberCount={members.length}
        connectionCount={connections.length}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 0,
          flex: 1,
          minHeight: 0,
        }}
      >
        <Section
          title="Members"
          action={
            !isArchived ? (
              <SectionButton onClick={() => setAddMemberOpen(true)}>
                Add member
              </SectionButton>
            ) : null
          }
          style={{ borderRight: "1px solid var(--rule)" }}
        >
          {members.length === 0 ? (
            <SectionEmpty>No members yet.</SectionEmpty>
          ) : (
            <MembersTable
              rows={members}
              onRemove={(m) => setRemoveMemberTarget(m)}
            />
          )}
        </Section>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <Section title="Connections">
            {connections.length === 0 ? (
              <SectionEmpty>
                No connections yet. Set up Claude Code or Claude Desktop in{" "}
                <Link
                  href="/admin/setup"
                  style={{ color: "var(--ink)", textDecoration: "underline" }}
                >
                  Setup
                </Link>
                .
              </SectionEmpty>
            ) : (
              <ConnectionsList
                rows={connections}
                onRemove={(c) => setRemoveConnectionTarget(c)}
              />
            )}
          </Section>

          <Section title="Danger zone">
            {!isArchived ? (
              <SectionButton
                tone="warn"
                onClick={() => setArchiveOpen(true)}
                full
              >
                Archive workspace
              </SectionButton>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <SectionButton onClick={restore} full>
                  Restore workspace
                </SectionButton>
                <SectionButton
                  tone="danger"
                  onClick={() => setPermanentDeleteOpen(true)}
                  full
                >
                  Permanently delete
                </SectionButton>
              </div>
            )}
          </Section>
        </div>
      </div>

      {addMemberOpen ? (
        <AddMemberDialog
          slug={slug}
          existingMemberIds={new Set(members.map((m) => m.principal.id))}
          onClose={() => setAddMemberOpen(false)}
          onAdded={(rawKey) => {
            setAddMemberOpen(false);
            void loadAll();
            if (rawKey) setRevealKey(rawKey);
          }}
          onError={(m) => setToast(m)}
        />
      ) : null}

      {removeMemberTarget ? (
        <ConfirmDialog
          title="Remove access?"
          body={`Remove ${removeMemberTarget.principal.name}'s access to this workspace?`}
          confirmLabel="Remove"
          confirmTone="warn"
          busy={busy}
          onCancel={() => setRemoveMemberTarget(null)}
          onConfirm={() => removeMember(removeMemberTarget)}
        />
      ) : null}

      {removeConnectionTarget ? (
        <ConfirmDialog
          title={`Remove ${removeConnectionTarget.label}?`}
          body="This permanently removes the connection and revokes its API key. You can set it up again later."
          confirmLabel="Remove"
          confirmTone="danger"
          busy={busy}
          onCancel={() => setRemoveConnectionTarget(null)}
          onConfirm={() => removeConnection(removeConnectionTarget)}
        />
      ) : null}

      {archiveOpen ? (
        <ConfirmDialog
          title={`Archive "${displayName}"?`}
          body="Archive this workspace? It will be hidden but can be restored later. Members lose access immediately."
          confirmLabel="Archive workspace"
          confirmTone="warn"
          busy={busy}
          onCancel={() => setArchiveOpen(false)}
          onConfirm={archive}
        />
      ) : null}

      {permanentDeleteOpen ? (
        <PermanentDeleteDialog
          slug={slug}
          displayName={displayName}
          busy={busy}
          onCancel={() => setPermanentDeleteOpen(false)}
          onConfirmed={async () => {
            setBusy(true);
            try {
              await adminFetch(`/admin/namespaces/${slug}/permanent`, {
                method: "DELETE",
                namespace: slug,
                body: JSON.stringify({ confirmation: slug }),
              });
              router.push("/admin/workspaces");
            } catch (err) {
              setToast(err instanceof Error ? err.message : "delete failed");
              setPermanentDeleteOpen(false);
            } finally {
              setBusy(false);
            }
          }}
          onError={(m) => setToast(m)}
        />
      ) : null}

      {revealKey ? (
        <CredentialReveal
          rawKey={revealKey}
          onClose={() => setRevealKey(null)}
        />
      ) : null}

      {toast ? (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      ) : null}
    </div>
  );
}

function Hero({
  workspace,
  memberCount,
  connectionCount,
}: {
  workspace: Namespace;
  memberCount: number;
  connectionCount: number;
}) {
  const displayName = workspace.display_name || workspace.name;
  return (
    <header
      style={{
        padding: "20px 28px 18px",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Link
          href="/admin/workspaces"
          style={{ color: "var(--ink-dim)", textDecoration: "none" }}
        >
          Workspaces
        </Link>
        <span>/</span>
        <span style={{ color: "var(--ink-dim)" }}>{workspace.name}</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-plex-serif)",
            fontWeight: 400,
            fontSize: 30,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
          }}
        >
          {displayName}
        </h1>
        <StatusPill status={workspace.status} />
      </div>

      {workspace.description ? (
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-plex-sans)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--ink-dim)",
            maxWidth: "62ch",
          }}
        >
          {workspace.description}
        </p>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: 24,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          color: "var(--ink-dim)",
          letterSpacing: "0.04em",
          marginTop: 4,
        }}
      >
        <Stat label="Type" value={TYPE_LABEL[workspace.type] ?? workspace.type} />
        <Stat label="Slug" value={workspace.name} mono />
        <Stat label="Members" value={String(memberCount)} />
        <Stat label="Connections" value={String(connectionCount)} />
        <Stat label="Created" value={formatDate(workspace.created_at)} />
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 9,
          letterSpacing: "0.16em",
          color: "var(--ink-faint)",
        }}
      >
        {label.toUpperCase()}
      </span>
      <span
        style={{
          fontFamily: mono ? "var(--font-plex-mono)" : "var(--font-plex-sans)",
          fontSize: 13,
          color: "var(--ink)",
          letterSpacing: 0,
          textTransform: "none",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  action,
  children,
  style,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        borderBottom: "1px solid var(--rule)",
        ...style,
      }}
    >
      <header
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-dim)",
            fontWeight: 400,
          }}
        >
          {title}
        </h2>
        <div style={{ flex: 1 }} />
        {action}
      </header>
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </section>
  );
}

function SectionEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontFamily: "var(--font-plex-sans)",
        fontSize: 13,
        color: "var(--ink-dim)",
      }}
    >
      {children}
    </p>
  );
}

function SectionButton({
  children,
  onClick,
  tone = "default",
  full,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "warn" | "danger";
  full?: boolean;
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
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        padding: "6px 12px",
        background: "transparent",
        color,
        border: `1px solid ${color}`,
        cursor: "pointer",
        width: full ? "100%" : "auto",
      }}
    >
      {children}
    </button>
  );
}

function MembersTable({
  rows,
  onRemove,
}: {
  rows: MemberRow[];
  onRemove: (m: MemberRow) => void;
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
      <tbody>
        {rows.map(({ principal: p, grant: g }) => (
          <tr
            key={g.id}
            style={{
              borderBottom: "1px solid var(--rule)",
            }}
          >
            <td style={{ padding: "10px 0", verticalAlign: "middle" }}>
              <Link
                href={`/admin/team/${p.id}`}
                style={{
                  color: "var(--ink)",
                  fontWeight: 500,
                }}
              >
                {p.name}
              </Link>
              {p.email ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-dim)",
                    marginTop: 2,
                  }}
                >
                  {p.email}
                </div>
              ) : null}
            </td>
            <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
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
            </td>
            <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
              <StatusPill
                tone="info"
                label={ACCESS_LABEL[g.access_level] ?? g.access_level}
              />
            </td>
            <td
              style={{
                padding: "10px 0",
                verticalAlign: "middle",
                textAlign: "right",
              }}
            >
              <button
                type="button"
                onClick={() => onRemove({ principal: p, grant: g })}
                style={{
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  padding: "4px 8px",
                  background: "transparent",
                  color: "var(--ink-dim)",
                  border: "1px solid var(--rule)",
                  cursor: "pointer",
                }}
              >
                Remove
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConnectionsList({
  rows,
  onRemove,
}: {
  rows: ConnectionRow[];
  onRemove: (c: ConnectionRow) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((c) => (
        <div
          key={c.principalId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 12px",
            background: "var(--panel-2)",
            border: "1px solid var(--rule)",
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background:
                c.status === "active" ? "var(--c-cornerstone)" : "var(--ink-faint)",
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link
              href={`/admin/team/${c.principalId}`}
              style={{
                color: "var(--ink)",
                fontFamily: "var(--font-plex-sans)",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {c.label}
            </Link>
            <div
              style={{
                fontFamily: "var(--font-plex-mono)",
                fontSize: 11,
                color: "var(--ink-dim)",
                marginTop: 2,
              }}
            >
              {c.principalName}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRemove(c)}
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              padding: "4px 8px",
              background: "transparent",
              color: "var(--c-forge)",
              border: "1px solid var(--c-forge)",
              cursor: "pointer",
            }}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function AddMemberDialog({
  slug,
  existingMemberIds,
  onClose,
  onAdded,
  onError,
}: {
  slug: string;
  existingMemberIds: Set<string>;
  onClose: () => void;
  onAdded: (rawKey?: string) => void;
  onError: (m: string) => void;
}) {
  const [tab, setTab] = useState<"existing" | "new">("existing");
  const [available, setAvailable] = useState<Principal[] | null>(null);
  const [selected, setSelected] = useState("");
  const [accessLevel, setAccessLevel] = useState("read");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"human" | "service">("human");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const all = await adminFetch<Principal[]>("/admin/principals", {
          namespace: slug,
        });
        setAvailable(
          all.filter(
            (p) => !existingMemberIds.has(p.id) && p.status === "active",
          ),
        );
      } catch {
        setAvailable([]);
      }
    })();
  }, [existingMemberIds]);

  const grantExisting = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await adminFetch(`/admin/principals/${selected}/grants`, {
        method: "POST",
        namespace: slug,
        body: JSON.stringify({ namespace: slug, access_level: accessLevel }),
      });
      onAdded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "add failed");
    } finally {
      setBusy(false);
    }
  };

  const setupNew = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const result = await adminFetch<SetupClientResult>(
        `/admin/workspaces/${slug}/setup-client`,
        {
          method: "POST",
          namespace: slug,
          body: JSON.stringify({
            principal_name: newName.trim(),
            type: newType,
          }),
        },
      );
      onAdded(result.raw_key);
    } catch (err) {
      onError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add member" onClose={onClose}>
      <div
        style={{
          display: "flex",
          gap: 0,
          border: "1px solid var(--rule)",
          alignSelf: "flex-start",
        }}
      >
        {(["existing", "new"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              padding: "5px 12px",
              border: "none",
              borderRight: t === "existing" ? "1px solid var(--rule)" : "none",
              background: tab === t ? "var(--ink)" : "transparent",
              color: tab === t ? "var(--panel)" : "var(--ink-dim)",
              cursor: "pointer",
            }}
          >
            {t === "existing" ? "Existing user" : "New user"}
          </button>
        ))}
      </div>

      {tab === "existing" ? (
        <>
          <Field label="User">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={modalInputStyle}
              disabled={!available}
            >
              <option value="">
                {available === null ? "Loading…" : "Select a user…"}
              </option>
              {(available ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.email ? ` (${p.email})` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Access level">
            <select
              value={accessLevel}
              onChange={(e) => setAccessLevel(e.target.value)}
              style={modalInputStyle}
            >
              <option value="read">Read</option>
              <option value="write">Write</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <ModalFooter
            primaryLabel={busy ? "Adding…" : "Grant access"}
            primaryDisabled={busy || !selected}
            onPrimary={grantExisting}
            onCancel={onClose}
          />
        </>
      ) : (
        <>
          <Field label="Name">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. jane-smith or claude-code--acme"
              style={modalInputStyle}
            />
          </Field>
          <Field label="Type">
            <select
              value={newType}
              onChange={(e) =>
                setNewType(e.target.value as "human" | "service")
              }
              style={modalInputStyle}
            >
              <option value="human">Human</option>
              <option value="service">Service</option>
            </select>
          </Field>
          <ModalFooter
            primaryLabel={busy ? "Creating…" : "Create & grant"}
            primaryDisabled={busy || !newName.trim()}
            onPrimary={setupNew}
            onCancel={onClose}
          />
        </>
      )}
    </Modal>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirmTone,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  confirmTone: "warn" | "danger";
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          lineHeight: 1.55,
          color: "var(--ink-dim)",
        }}
      >
        {body}
      </p>
      <ModalFooter
        primaryLabel={busy ? "Working…" : confirmLabel}
        primaryDisabled={busy}
        primaryTone={confirmTone}
        onPrimary={onConfirm}
        onCancel={onCancel}
      />
    </Modal>
  );
}

function PermanentDeleteDialog({
  slug,
  displayName,
  busy,
  onCancel,
  onConfirmed,
  onError,
}: {
  slug: string;
  displayName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirmed: () => void;
  onError: (m: string) => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [impact, setImpact] = useState<{
    fact_count: number;
    note_count: number;
    principal_count: number;
  } | null>(null);
  const [impactLoading, setImpactLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const data = await adminFetch<{
          fact_count: number;
          note_count: number;
          principal_count: number;
        }>(`/admin/namespaces/${slug}/deletion-impact`, { namespace: slug });
        setImpact(data);
      } catch (err) {
        onError(err instanceof Error ? err.message : "impact load failed");
      } finally {
        setImpactLoading(false);
      }
    })();
  }, [slug, onError]);

  return (
    <Modal title={`Permanently delete "${displayName}"?`} onClose={onCancel}>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          color: "var(--c-forge)",
        }}
      >
        This cannot be undone.
      </p>
      <div
        style={{
          padding: "10px 12px",
          background: "var(--bg)",
          border: "1px solid var(--rule)",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 12,
          color: "var(--ink-dim)",
          lineHeight: 1.7,
        }}
      >
        {impactLoading ? (
          "Loading impact…"
        ) : impact ? (
          <>
            <div>
              <span style={{ color: "var(--ink)" }}>{impact.fact_count}</span>{" "}
              facts
            </div>
            <div>
              <span style={{ color: "var(--ink)" }}>{impact.note_count}</span>{" "}
              notes
            </div>
            <div>
              <span style={{ color: "var(--ink)" }}>
                {impact.principal_count}
              </span>{" "}
              connected users
            </div>
          </>
        ) : (
          "Couldn't load impact."
        )}
      </div>
      <Field label={`Type "${slug}" to confirm`}>
        <input
          autoFocus
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={slug}
          style={modalInputStyle}
        />
      </Field>
      <ModalFooter
        primaryLabel={busy ? "Deleting…" : "Delete permanently"}
        primaryDisabled={busy || confirm !== slug}
        primaryTone="danger"
        onPrimary={onConfirmed}
        onCancel={onCancel}
      />
    </Modal>
  );
}
