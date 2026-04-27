"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-api";
import type {
  Credential,
  Namespace,
  NamespaceGrant,
  Principal,
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

type DetailState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      principal: Principal;
      credentials: Credential[];
      grants: NamespaceGrant[];
      namespaces: Namespace[];
    };

const PERMISSION_LEVELS = [
  { value: "read", label: "Read", caps: ["read"] },
  { value: "read-write", label: "Read / Write", caps: ["read", "write", "ingest"] },
  { value: "admin", label: "Admin", caps: ["read", "write", "ingest", "admin"] },
] as const;

const ACCESS_LABEL: Record<string, string> = {
  read: "Read",
  write: "Write",
  admin: "Admin",
};

function capsToLevel(caps: string[]): string {
  if (caps.includes("admin")) return "admin";
  if (caps.includes("write")) return "read-write";
  return "read";
}

function levelToCaps(level: string): string[] {
  return (
    PERMISSION_LEVELS.find((p) => p.value === level)?.caps.slice() ?? ["read"]
  );
}

function statusDescription(status: string): string {
  if (status === "active")
    return "This user can authenticate and access all assigned workspaces.";
  if (status === "suspended")
    return "This user is suspended. All API requests are blocked and workspace access is revoked.";
  if (status === "archived")
    return "This user is archived. All API keys have been revoked. Workspace access is preserved but frozen. Can be reactivated.";
  if (status === "deleted")
    return "This user has been permanently deleted. All API keys and workspace access have been removed.";
  return "This user is disabled.";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminTeamMemberPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);
  const router = useRouter();

  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState<string | null>(null);

  const [issueOpen, setIssueOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [pendingRevokeCred, setPendingRevokeCred] = useState<Credential | null>(
    null,
  );
  const [pendingRevokeGrant, setPendingRevokeGrant] =
    useState<NamespaceGrant | null>(null);
  const [pendingStatus, setPendingStatus] = useState<
    "active" | "suspended" | "archived" | "deleted" | null
  >(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const loadAll = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [principal, credentials, grants, namespaces] = await Promise.all([
        adminFetch<Principal>(`/admin/principals/${userId}`),
        adminFetch<Credential[]>(`/admin/principals/${userId}/credentials`),
        adminFetch<NamespaceGrant[]>(`/admin/principals/${userId}/grants`),
        adminFetch<Namespace[]>("/admin/namespaces").catch(
          () => [] as Namespace[],
        ),
      ]);
      setState({
        status: "loaded",
        principal,
        credentials,
        grants,
        namespaces,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed to load";
      if (msg.includes("404")) {
        setState({ status: "not_found" });
      } else {
        setState({ status: "error", message: msg });
      }
    }
  }, [userId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  if (state.status === "loading") {
    return <Empty>Loading principal…</Empty>;
  }
  if (state.status === "not_found") {
    return (
      <Empty>
        Principal not found.{" "}
        <Link
          href="/admin/team"
          style={{ color: "var(--ink)", textDecoration: "underline" }}
        >
          Back to team
        </Link>
        .
      </Empty>
    );
  }
  if (state.status === "error") {
    return <Empty>Couldn&rsquo;t load — {state.message}</Empty>;
  }

  const { principal, credentials, grants, namespaces } = state;
  const grantableNamespaces = namespaces.filter(
    (ns) =>
      ns.status === "active" && !grants.some((g) => g.namespace === ns.name),
  );
  const isArchived = principal.status === "archived";
  const isDeleted = principal.status === "deleted";
  const canMutate = !isArchived && !isDeleted;

  const issueKey = async (label: string, level: string) => {
    setBusy(true);
    try {
      const result = await adminFetch<{
        credential: Credential;
        raw_key: string;
      }>(`/admin/principals/${userId}/credentials`, {
        method: "POST",
        body: JSON.stringify({
          label: label.trim(),
          capabilities: levelToCaps(level),
        }),
      });
      setState((s) =>
        s.status === "loaded"
          ? { ...s, credentials: [result.credential, ...s.credentials] }
          : s,
      );
      setIssueOpen(false);
      setRevealKey(result.raw_key);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "could not create key");
    } finally {
      setBusy(false);
    }
  };

  const revokeCredential = async (cred: Credential) => {
    setBusy(true);
    const previous = credentials;
    setState((s) =>
      s.status === "loaded"
        ? {
            ...s,
            credentials: s.credentials.map((c) =>
              c.id === cred.id ? { ...c, status: "revoked" } : c,
            ),
          }
        : s,
    );
    try {
      await adminFetch(
        `/admin/principals/${userId}/credentials/${cred.id}`,
        { method: "DELETE" },
      );
      setPendingRevokeCred(null);
      showToast("Connection key revoked.");
    } catch (err) {
      setState((s) =>
        s.status === "loaded" ? { ...s, credentials: previous } : s,
      );
      showToast(err instanceof Error ? err.message : "revoke failed");
    } finally {
      setBusy(false);
    }
  };

  const grantAccess = async (namespace: string, level: string) => {
    setBusy(true);
    try {
      const created = await adminFetch<NamespaceGrant>(
        `/admin/principals/${userId}/grants`,
        {
          method: "POST",
          body: JSON.stringify({ namespace, access_level: level }),
        },
      );
      setState((s) =>
        s.status === "loaded"
          ? { ...s, grants: [created, ...s.grants] }
          : s,
      );
      setGrantOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "grant failed");
    } finally {
      setBusy(false);
    }
  };

  const removeGrant = async (g: NamespaceGrant) => {
    setBusy(true);
    try {
      await adminFetch(
        `/admin/principals/${userId}/grants/${g.namespace}`,
        { method: "DELETE" },
      );
      setState((s) =>
        s.status === "loaded"
          ? { ...s, grants: s.grants.filter((row) => row.id !== g.id) }
          : s,
      );
      setPendingRevokeGrant(null);
      showToast("Workspace access removed.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "remove failed");
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (
    next: "active" | "suspended" | "archived",
  ) => {
    setBusy(true);
    try {
      const updated = await adminFetch<Principal>(
        `/admin/principals/${userId}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: next }),
        },
      );
      setState((s) =>
        s.status === "loaded" ? { ...s, principal: updated } : s,
      );
      setPendingStatus(null);
      showToast(`${updated.name} is now ${updated.status}.`);
      if (next === "archived" || next === "active") {
        await loadAll();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "status change failed");
    } finally {
      setBusy(false);
    }
  };

  const permanentDelete = async () => {
    setBusy(true);
    try {
      await adminFetch(`/admin/principals/${userId}/permanent`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation: principal.name }),
      });
      router.push("/admin/team");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "delete failed");
      setPendingStatus(null);
    } finally {
      setBusy(false);
    }
  };

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
        principal={principal}
        activeKeyCount={credentials.filter((c) => c.status === "active").length}
        workspaceCount={grants.length}
        canMutate={canMutate}
        onArchive={() => setPendingStatus("archived")}
        onSuspend={() => setPendingStatus("suspended")}
        onReactivate={() => setPendingStatus("active")}
        onDeletePermanent={() => setPendingStatus("deleted")}
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid var(--rule)",
          }}
        >
          <Section
            title="Connection Keys"
            action={
              canMutate ? (
                <SectionButton onClick={() => setIssueOpen(true)}>
                  Create key
                </SectionButton>
              ) : null
            }
          >
            {credentials.length === 0 ? (
              <SectionEmpty>
                No connection keys for this user. Create one so they can
                connect.
              </SectionEmpty>
            ) : (
              <CredentialsTable
                rows={credentials}
                canMutate={canMutate}
                onRevoke={(c) => setPendingRevokeCred(c)}
              />
            )}
          </Section>

          <Section
            title="Workspace Access"
            action={
              canMutate && grantableNamespaces.length > 0 ? (
                <SectionButton onClick={() => setGrantOpen(true)}>
                  Add to workspace
                </SectionButton>
              ) : null
            }
          >
            {grants.length === 0 ? (
              <SectionEmpty>
                No workspace access. Add this user to a workspace so they can
                read and contribute information.
              </SectionEmpty>
            ) : (
              <GrantsTable
                rows={grants}
                canMutate={canMutate}
                onRemove={(g) => setPendingRevokeGrant(g)}
              />
            )}
          </Section>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <Section title="Status">
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-plex-sans)",
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--ink-dim)",
              }}
            >
              {statusDescription(principal.status)}
            </p>
          </Section>

          <Section title="Lifecycle">
            <div
              style={{
                fontFamily: "var(--font-plex-mono)",
                fontSize: 11,
                color: "var(--ink-dim)",
                lineHeight: 1.8,
              }}
            >
              <div>
                <span style={{ color: "var(--ink-faint)" }}>JOINED · </span>
                {formatDate(principal.created_at)}
              </div>
              {principal.archived_at ? (
                <div>
                  <span style={{ color: "var(--ink-faint)" }}>
                    ARCHIVED ·{" "}
                  </span>
                  {formatDateTime(principal.archived_at)}
                </div>
              ) : null}
              {principal.deleted_at ? (
                <div>
                  <span style={{ color: "var(--ink-faint)" }}>DELETED · </span>
                  {formatDateTime(principal.deleted_at)}
                </div>
              ) : null}
            </div>
          </Section>

          {!isDeleted ? (
            <Section title="Danger zone">
              <div
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                {principal.status === "active" ? (
                  <>
                    <SectionButton
                      tone="warn"
                      full
                      onClick={() => setPendingStatus("archived")}
                    >
                      Archive principal
                    </SectionButton>
                    <SectionButton
                      tone="danger"
                      full
                      onClick={() => setPendingStatus("suspended")}
                    >
                      Suspend
                    </SectionButton>
                  </>
                ) : null}
                {principal.status === "suspended" ? (
                  <>
                    <SectionButton
                      full
                      onClick={() => setPendingStatus("active")}
                    >
                      Reactivate
                    </SectionButton>
                    <SectionButton
                      tone="warn"
                      full
                      onClick={() => setPendingStatus("archived")}
                    >
                      Archive
                    </SectionButton>
                  </>
                ) : null}
                {principal.status === "archived" ? (
                  <>
                    <SectionButton
                      full
                      onClick={() => setPendingStatus("active")}
                    >
                      Reactivate
                    </SectionButton>
                    <SectionButton
                      tone="danger"
                      full
                      onClick={() => setPendingStatus("deleted")}
                    >
                      Delete permanently
                    </SectionButton>
                  </>
                ) : null}
              </div>
            </Section>
          ) : null}
        </div>
      </div>

      {issueOpen ? (
        <IssueKeyDialog
          principalName={principal.name}
          busy={busy}
          onCancel={() => setIssueOpen(false)}
          onIssue={issueKey}
        />
      ) : null}

      {grantOpen ? (
        <GrantAccessDialog
          principalName={principal.name}
          available={grantableNamespaces}
          busy={busy}
          onCancel={() => setGrantOpen(false)}
          onGrant={grantAccess}
        />
      ) : null}

      {pendingRevokeCred ? (
        <ConfirmDialog
          title="Revoke connection key?"
          body="This key will immediately stop working. The user will need a new key to reconnect."
          confirmLabel="Revoke"
          confirmTone="danger"
          busy={busy}
          onCancel={() => setPendingRevokeCred(null)}
          onConfirm={() => revokeCredential(pendingRevokeCred)}
        />
      ) : null}

      {pendingRevokeGrant ? (
        <ConfirmDialog
          title="Remove workspace access?"
          body={`Remove access to "${pendingRevokeGrant.namespace}"? Their connection key still works for other workspaces.`}
          confirmLabel="Remove"
          confirmTone="warn"
          busy={busy}
          onCancel={() => setPendingRevokeGrant(null)}
          onConfirm={() => removeGrant(pendingRevokeGrant)}
        />
      ) : null}

      {pendingStatus === "suspended" ? (
        <ConfirmDialog
          title={`Suspend ${principal.name}?`}
          body="They will not be able to access any workspaces. This can be reversed at any time."
          confirmLabel="Suspend"
          confirmTone="danger"
          busy={busy}
          onCancel={() => setPendingStatus(null)}
          onConfirm={() => changeStatus("suspended")}
        />
      ) : null}

      {pendingStatus === "archived" ? (
        <ConfirmDialog
          title={`Archive ${principal.name}?`}
          body="All active connection keys will be revoked immediately. This can be reversed, but new keys must be created."
          confirmLabel="Archive"
          confirmTone="warn"
          busy={busy}
          onCancel={() => setPendingStatus(null)}
          onConfirm={() => changeStatus("archived")}
        />
      ) : null}

      {pendingStatus === "active" ? (
        <ConfirmDialog
          title={`Reactivate ${principal.name}?`}
          body={
            principal.status === "archived"
              ? "This will restore access to previously assigned workspaces. New connection keys must be created after reactivation."
              : "This will restore access to all previously assigned workspaces."
          }
          confirmLabel="Reactivate"
          confirmTone="warn"
          busy={busy}
          onCancel={() => setPendingStatus(null)}
          onConfirm={() => changeStatus("active")}
        />
      ) : null}

      {pendingStatus === "deleted" ? (
        <PermanentDeleteDialog
          userId={userId}
          principalName={principal.name}
          busy={busy}
          onCancel={() => setPendingStatus(null)}
          onConfirmed={permanentDelete}
          onError={(m) => showToast(m)}
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
  principal,
  activeKeyCount,
  workspaceCount,
  canMutate,
  onArchive,
  onSuspend,
  onReactivate,
  onDeletePermanent,
}: {
  principal: Principal;
  activeKeyCount: number;
  workspaceCount: number;
  canMutate: boolean;
  onArchive: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onDeletePermanent: () => void;
}) {
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
          href="/admin/team"
          style={{ color: "var(--ink-dim)", textDecoration: "none" }}
        >
          Team
        </Link>
        <span>/</span>
        <span style={{ color: "var(--ink-dim)" }}>{principal.name}</span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
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
          {principal.name}
        </h1>
        <StatusPill status={principal.status} />
        <span
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            color: "var(--ink-dim)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {principal.type}
        </span>
      </div>

      {principal.email ? (
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-plex-sans)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--ink-dim)",
          }}
        >
          {principal.email}
        </p>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginTop: 4,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 24,
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            color: "var(--ink-dim)",
            letterSpacing: "0.04em",
          }}
        >
          <Stat label="Active Keys" value={String(activeKeyCount)} />
          <Stat label="Workspaces" value={String(workspaceCount)} />
          <Stat label="Joined" value={formatDate(principal.created_at)} />
          {principal.archived_at ? (
            <Stat
              label="Archived"
              value={formatDate(principal.archived_at)}
            />
          ) : null}
        </div>

        {canMutate ? (
          <div style={{ display: "flex", gap: 8 }}>
            {principal.status === "active" ? (
              <>
                <SectionButton tone="warn" onClick={onArchive}>
                  Archive
                </SectionButton>
                <SectionButton tone="danger" onClick={onSuspend}>
                  Suspend
                </SectionButton>
              </>
            ) : null}
            {principal.status === "suspended" ? (
              <>
                <SectionButton tone="warn" onClick={onArchive}>
                  Archive
                </SectionButton>
                <SectionButton onClick={onReactivate}>Reactivate</SectionButton>
              </>
            ) : null}
          </div>
        ) : principal.status === "archived" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <SectionButton onClick={onReactivate}>Reactivate</SectionButton>
            <SectionButton tone="danger" onClick={onDeletePermanent}>
              Delete permanently
            </SectionButton>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 9,
          letterSpacing: "0.16em",
          color: "var(--ink-faint)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-plex-sans)",
          fontSize: 13,
          color: "var(--ink)",
          letterSpacing: 0,
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
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        borderBottom: "1px solid var(--rule)",
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

function CredentialsTable({
  rows,
  canMutate,
  onRevoke,
}: {
  rows: Credential[];
  canMutate: boolean;
  onRevoke: (c: Credential) => void;
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
        {rows.map((c) => (
          <tr
            key={c.id}
            style={{
              borderBottom: "1px solid var(--rule)",
              opacity: c.status === "revoked" ? 0.5 : 1,
            }}
          >
            <td style={{ padding: "10px 0", verticalAlign: "middle" }}>
              <div style={{ color: "var(--ink)", fontWeight: 500 }}>
                {c.label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 11,
                  color: "var(--ink-dim)",
                  marginTop: 2,
                }}
              >
                {c.key_prefix}…
              </div>
            </td>
            <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
              <StatusPill status={c.status} />
            </td>
            <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
              <StatusPill
                tone="info"
                label={ACCESS_LABEL[capsToLevel(c.capabilities)] ?? "Read"}
              />
            </td>
            <td
              style={{
                padding: "10px 12px",
                verticalAlign: "middle",
                fontFamily: "var(--font-plex-mono)",
                fontSize: 11,
                color: "var(--ink-dim)",
              }}
            >
              <div>Last used {formatDateTime(c.last_used_at)}</div>
              {c.revoked_at ? (
                <div style={{ color: "var(--c-forge)" }}>
                  Revoked {formatDateTime(c.revoked_at)}
                </div>
              ) : null}
            </td>
            <td
              style={{
                padding: "10px 0",
                verticalAlign: "middle",
                textAlign: "right",
              }}
            >
              {canMutate && c.status !== "revoked" ? (
                <button
                  type="button"
                  onClick={() => onRevoke(c)}
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
                  Revoke
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GrantsTable({
  rows,
  canMutate,
  onRemove,
}: {
  rows: NamespaceGrant[];
  canMutate: boolean;
  onRemove: (g: NamespaceGrant) => void;
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
        {rows.map((g) => (
          <tr
            key={g.id}
            style={{ borderBottom: "1px solid var(--rule)" }}
          >
            <td style={{ padding: "10px 0", verticalAlign: "middle" }}>
              <Link
                href={`/admin/workspaces/${g.namespace}`}
                style={{ color: "var(--ink)", fontWeight: 500 }}
              >
                {g.namespace_display_name || g.namespace}
              </Link>
              <div
                style={{
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 11,
                  color: "var(--ink-dim)",
                  marginTop: 2,
                }}
              >
                {g.namespace}
              </div>
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
              {canMutate ? (
                <button
                  type="button"
                  onClick={() => onRemove(g)}
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
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IssueKeyDialog({
  principalName,
  busy,
  onCancel,
  onIssue,
}: {
  principalName: string;
  busy: boolean;
  onCancel: () => void;
  onIssue: (label: string, level: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [level, setLevel] = useState("read");
  return (
    <Modal title="Create connection key" onClose={onCancel}>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          color: "var(--ink-dim)",
        }}
      >
        Create a key for {principalName} to connect Claude Desktop or Claude
        Code to Cornerstone.
      </p>
      <Field label="Label">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Claude Desktop"
          style={modalInputStyle}
        />
      </Field>
      <Field label="Permissions">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          style={modalInputStyle}
        >
          {PERMISSION_LEVELS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <ModalFooter
        primaryLabel={busy ? "Creating…" : "Create"}
        primaryDisabled={busy || !label.trim()}
        onPrimary={() => onIssue(label, level)}
        onCancel={onCancel}
      />
    </Modal>
  );
}

function GrantAccessDialog({
  principalName,
  available,
  busy,
  onCancel,
  onGrant,
}: {
  principalName: string;
  available: Namespace[];
  busy: boolean;
  onCancel: () => void;
  onGrant: (namespace: string, level: string) => void;
}) {
  const [namespace, setNamespace] = useState("");
  const [level, setLevel] = useState("read");
  return (
    <Modal title="Add to workspace" onClose={onCancel}>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          color: "var(--ink-dim)",
        }}
      >
        Give {principalName} access to an additional workspace. No new key is
        needed — their existing key will work.
      </p>
      <Field label="Workspace">
        <select
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          style={modalInputStyle}
        >
          <option value="">Select workspace…</option>
          {available.map((ns) => (
            <option key={ns.name} value={ns.name}>
              {ns.display_name || ns.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Access level">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          style={modalInputStyle}
        >
          <option value="read">Read</option>
          <option value="write">Write</option>
          <option value="admin">Admin</option>
        </select>
      </Field>
      <ModalFooter
        primaryLabel={busy ? "Adding…" : "Grant access"}
        primaryDisabled={busy || !namespace}
        onPrimary={() => onGrant(namespace, level)}
        onCancel={onCancel}
      />
    </Modal>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirmTone,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  confirmTone: "warn" | "danger";
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
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
  userId,
  principalName,
  busy,
  onCancel,
  onConfirmed,
  onError,
}: {
  userId: string;
  principalName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirmed: () => void;
  onError: (m: string) => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [impact, setImpact] = useState<{
    credential_count: number;
    grant_count: number;
    role_count?: number;
  } | null>(null);
  const [impactLoading, setImpactLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const data = await adminFetch<{
          credential_count: number;
          grant_count: number;
          role_count?: number;
        }>(`/admin/principals/${userId}/deletion-impact`);
        setImpact(data);
      } catch (err) {
        onError(err instanceof Error ? err.message : "impact load failed");
      } finally {
        setImpactLoading(false);
      }
    })();
  }, [userId, onError]);

  return (
    <Modal
      title={`Permanently delete ${principalName}?`}
      onClose={onCancel}
    >
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
              <span style={{ color: "var(--ink)" }}>
                {impact.credential_count}
              </span>{" "}
              connection key{impact.credential_count !== 1 ? "s" : ""}
            </div>
            <div>
              <span style={{ color: "var(--ink)" }}>{impact.grant_count}</span>{" "}
              workspace{impact.grant_count !== 1 ? "s" : ""}
            </div>
            {typeof impact.role_count === "number" ? (
              <div>
                <span style={{ color: "var(--ink)" }}>{impact.role_count}</span>{" "}
                role{impact.role_count !== 1 ? "s" : ""}
              </div>
            ) : null}
          </>
        ) : (
          "Couldn't load impact."
        )}
      </div>
      <Field label={`Type "${principalName}" to confirm`}>
        <input
          autoFocus
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={principalName}
          style={modalInputStyle}
        />
      </Field>
      <ModalFooter
        primaryLabel={busy ? "Deleting…" : "Delete permanently"}
        primaryDisabled={busy || confirm !== principalName}
        primaryTone="danger"
        onPrimary={onConfirmed}
        onCancel={onCancel}
      />
    </Modal>
  );
}
