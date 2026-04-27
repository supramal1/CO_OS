"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-api";
import type { AdminStatus, Namespace } from "@/lib/admin-types";
import { useAdminWorkspace } from "@/components/admin/workspace-selector";
import { StatusPill } from "@/components/admin/status-pill";
import {
  Empty,
  Field,
  Modal,
  ModalFooter,
  Toast,
  modalInputStyle,
} from "@/components/admin/modal";

type ListState =
  | { status: "loading" }
  | { status: "loaded"; namespaces: Namespace[]; admin: AdminStatus | null }
  | { status: "error"; message: string };

type Filter = "active" | "archived" | "all";

const NS_TYPES: Array<{ value: string; label: string }> = [
  { value: "client", label: "Client" },
  { value: "client_sub", label: "Client (sub)" },
  { value: "internal", label: "Internal" },
  { value: "system", label: "System" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  NS_TYPES.map((t) => [t.value, t.label]),
);

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function AdminWorkspacesPage() {
  const router = useRouter();
  const { registerWorkspace, selectedWorkspace } = useAdminWorkspace();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Namespace | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Namespace | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    if (!selectedWorkspace) return;
    setState({ status: "loading" });
    try {
      const includeArchived = filter !== "active";
      const [admin, namespaces] = await Promise.all([
        adminFetch<AdminStatus>("/admin/status", {
          namespace: selectedWorkspace,
        }).catch(() => null),
        adminFetch<Namespace[]>(
          `/admin/namespaces${includeArchived ? "?include_archived=true" : ""}`,
          { namespace: selectedWorkspace },
        ),
      ]);
      setState({ status: "loaded", admin, namespaces });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "failed to load",
      });
    }
  };

  useEffect(() => {
    void load();
  }, [filter, selectedWorkspace]);

  const namespaces = state.status === "loaded" ? state.namespaces : [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return namespaces.filter((ns) => {
      if (filter === "active" && ns.status !== "active") return false;
      if (filter === "archived" && ns.status === "active") return false;
      if (!q) return true;
      return (
        ns.name.toLowerCase().includes(q) ||
        (ns.display_name ?? "").toLowerCase().includes(q) ||
        (ns.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [namespaces, filter, search]);

  const activeCount = namespaces.filter((n) => n.status === "active").length;
  const archivedCount = namespaces.length - activeCount;

  const selectableActive = filtered.filter((n) => n.status === "active");
  const allActiveSelected =
    selectableActive.length > 0 &&
    selectableActive.every((n) => selected.has(n.id));

  const toggleAll = () => {
    if (allActiveSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableActive.map((n) => n.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onCreated = (created: Namespace) => {
    setState((s) => {
      if (s.status !== "loaded") return s;
      return { ...s, namespaces: [created, ...s.namespaces] };
    });
    registerWorkspace(created.name);
    setCreateOpen(false);
    router.push(`/admin/workspaces/${created.name}`);
    router.refresh();
  };

  const archiveOne = async (ns: Namespace) => {
    setBusy(true);
    try {
      await adminFetch(`/admin/namespaces/${ns.name}`, {
        method: "DELETE",
        namespace: selectedWorkspace,
      });
      setState((s) => {
        if (s.status !== "loaded") return s;
        return {
          ...s,
          namespaces: s.namespaces.map((n) =>
            n.name === ns.name ? { ...n, status: "archived" } : n,
          ),
        };
      });
      setArchiveTarget(null);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "archive failed");
    } finally {
      setBusy(false);
    }
  };

  const restoreOne = async (ns: Namespace) => {
    setBusy(true);
    try {
      await adminFetch<Namespace>(`/admin/namespaces/${ns.name}`, {
        method: "PATCH",
        namespace: selectedWorkspace,
        body: JSON.stringify({ status: "active" }),
      });
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "restore failed");
    } finally {
      setBusy(false);
    }
  };

  const bulkArchive = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const names = namespaces
        .filter((n) => selected.has(n.id))
        .map((n) => n.name);
      await adminFetch("/admin/namespaces/bulk-archive", {
        method: "POST",
        namespace: selectedWorkspace,
        body: JSON.stringify({ namespaces: names }),
      });
      setSelected(new Set());
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "bulk archive failed");
    } finally {
      setBusy(false);
    }
  };

  const permanentDelete = async (ns: Namespace) => {
    setBusy(true);
    try {
      await adminFetch(`/admin/namespaces/${ns.name}/permanent`, {
        method: "DELETE",
        namespace: selectedWorkspace,
      });
      setState((s) => {
        if (s.status !== "loaded") return s;
        return {
          ...s,
          namespaces: s.namespaces.filter((n) => n.name !== ns.name),
        };
      });
      setDeleteTarget(null);
      setDeleteConfirm("");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "delete failed");
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
      }}
    >
      <Header
        admin={state.status === "loaded" ? state.admin : null}
        activeCount={activeCount}
        archivedCount={archivedCount}
        onCreate={() => setCreateOpen(true)}
      />

      <Toolbar
        filter={filter}
        setFilter={setFilter}
        search={search}
        setSearch={setSearch}
        allActiveSelected={allActiveSelected}
        toggleAll={toggleAll}
        selectableCount={selectableActive.length}
      />

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {state.status === "loading" ? (
          <Empty>Loading workspaces…</Empty>
        ) : state.status === "error" ? (
          <Empty>Couldn&rsquo;t load — {state.message}</Empty>
        ) : filtered.length === 0 ? (
          <Empty>
            {search
              ? "No workspaces match your search."
              : filter === "archived"
                ? "No archived workspaces."
                : "No workspaces yet."}
          </Empty>
        ) : (
          <Table
            rows={filtered}
            selected={selected}
            onToggle={toggleOne}
            onArchive={(ns) => setArchiveTarget(ns)}
            onRestore={(ns) => restoreOne(ns)}
            onDelete={(ns) => {
              setDeleteTarget(ns);
              setDeleteConfirm("");
            }}
          />
        )}
      </div>

      {selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          onCancel={() => setSelected(new Set())}
          onArchive={bulkArchive}
          busy={busy}
        />
      ) : null}

      {createOpen ? (
        <CreateDialog
          namespace={selectedWorkspace}
          onClose={() => setCreateOpen(false)}
          onCreated={onCreated}
          onError={(m) => setToast(m)}
        />
      ) : null}

      {archiveTarget ? (
        <ConfirmDialog
          title={`Archive "${archiveTarget.display_name || archiveTarget.name}"?`}
          body="Archiving prevents new data from being added. Existing data is preserved and can be restored. Members lose access immediately."
          confirmLabel="Archive workspace"
          confirmTone="warn"
          busy={busy}
          onCancel={() => setArchiveTarget(null)}
          onConfirm={() => archiveOne(archiveTarget)}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteDialog
          target={deleteTarget}
          confirm={deleteConfirm}
          setConfirm={setDeleteConfirm}
          busy={busy}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteConfirm("");
          }}
          onConfirm={() => permanentDelete(deleteTarget)}
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
  activeCount,
  archivedCount,
  onCreate,
}: {
  admin: AdminStatus | null;
  activeCount: number;
  archivedCount: number;
  onCreate: () => void;
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
          Admin · workspaces
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
          Workspaces
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
          <span style={{ color: "var(--ink)" }}>{activeCount}</span> active
        </span>
        <span style={{ color: "var(--ink-faint)" }}>·</span>
        <span>
          <span style={{ color: "var(--ink)" }}>{archivedCount}</span> archived
        </span>
        {admin ? (
          <>
            <span style={{ color: "var(--ink-faint)" }}>·</span>
            <span>
              <span style={{ color: "var(--ink)" }}>
                {admin.principal_count}
              </span>{" "}
              users
            </span>
          </>
        ) : null}
      </div>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onCreate}
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "6px 12px",
          background: "var(--ink)",
          color: "var(--panel)",
          border: "1px solid var(--ink)",
          cursor: "pointer",
        }}
      >
        New workspace
      </button>
    </header>
  );
}

function Toolbar({
  filter,
  setFilter,
  search,
  setSearch,
  allActiveSelected,
  toggleAll,
  selectableCount,
}: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  search: string;
  setSearch: (s: string) => void;
  allActiveSelected: boolean;
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
          checked={allActiveSelected}
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

      <div style={{ display: "flex", gap: 0, border: "1px solid var(--rule)" }}>
        {(["active", "archived", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              padding: "5px 10px",
              border: "none",
              borderRight:
                f !== "all" ? "1px solid var(--rule)" : "none",
              background: filter === f ? "var(--ink)" : "transparent",
              color: filter === f ? "var(--panel)" : "var(--ink-dim)",
              cursor: "pointer",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="Search workspaces…"
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

function Table({
  rows,
  selected,
  onToggle,
  onArchive,
  onRestore,
  onDelete,
}: {
  rows: Namespace[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onArchive: (ns: Namespace) => void;
  onRestore: (ns: Namespace) => void;
  onDelete: (ns: Namespace) => void;
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
          <Th>Slug</Th>
          <Th>Type</Th>
          <Th>Status</Th>
          <Th>Created</Th>
          <Th style={{ width: 160, textAlign: "right" }}>Actions</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((ns) => {
          const isArchived = ns.status !== "active";
          const isSelected = selected.has(ns.id);
          return (
            <tr
              key={ns.id}
              style={{
                borderBottom: "1px solid var(--rule)",
                background: isSelected ? "var(--panel-2)" : "transparent",
              }}
            >
              <Td>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(ns.id)}
                  disabled={isArchived}
                />
              </Td>
              <Td>
                <Link
                  href={`/admin/workspaces/${ns.name}`}
                  style={{ color: "var(--ink)", fontWeight: 500 }}
                >
                  {ns.display_name || ns.name}
                </Link>
                {ns.description ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-dim)",
                      marginTop: 2,
                      maxWidth: 460,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ns.description}
                  </div>
                ) : null}
              </Td>
              <Td>
                <span
                  style={{
                    fontFamily: "var(--font-plex-mono)",
                    fontSize: 12,
                    color: "var(--ink-dim)",
                  }}
                >
                  {ns.name}
                </span>
              </Td>
              <Td>
                <span style={{ color: "var(--ink-dim)" }}>
                  {TYPE_LABEL[ns.type] ?? ns.type}
                </span>
              </Td>
              <Td>
                <StatusPill status={ns.status} />
              </Td>
              <Td>
                <span style={{ color: "var(--ink-dim)" }}>
                  {formatDate(ns.created_at)}
                </span>
              </Td>
              <Td style={{ textAlign: "right" }}>
                {isArchived ? (
                  <RowActions>
                    <RowAction onClick={() => onRestore(ns)}>Restore</RowAction>
                    <RowAction tone="danger" onClick={() => onDelete(ns)}>
                      Delete
                    </RowAction>
                  </RowActions>
                ) : (
                  <RowAction tone="warn" onClick={() => onArchive(ns)}>
                    Archive
                  </RowAction>
                )}
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

function RowActions({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end" }}>
      {children}
    </div>
  );
}

function RowAction({
  children,
  onClick,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "warn" | "danger";
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
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        padding: "4px 8px",
        border: `1px solid ${color}`,
        background: "transparent",
        color,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function BulkBar({
  count,
  onCancel,
  onArchive,
  busy,
}: {
  count: number;
  onCancel: () => void;
  onArchive: () => void;
  busy: boolean;
}) {
  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 16px",
        background: "var(--ink)",
        color: "var(--panel)",
        boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        zIndex: 25,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {count} selected
      </span>
      <div style={{ width: 1, height: 16, background: "var(--ink-faint)" }} />
      <button
        type="button"
        onClick={onArchive}
        disabled={busy}
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "4px 10px",
          background: "var(--c-cookbook)",
          color: "var(--bg)",
          border: "1px solid var(--c-cookbook)",
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        Archive
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "4px 10px",
          background: "transparent",
          color: "var(--panel)",
          border: "1px solid var(--ink-faint)",
          cursor: "pointer",
        }}
      >
        Cancel
      </button>
    </div>
  );
}

function CreateDialog({
  namespace,
  onClose,
  onCreated,
  onError,
}: {
  namespace: string | null;
  onClose: () => void;
  onCreated: (ns: Namespace) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [type, setType] = useState("client");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await adminFetch<Namespace>("/admin/namespaces", {
        method: "POST",
        namespace,
        body: JSON.stringify({
          name: name.trim(),
          display_name: displayName.trim() || name.trim(),
          type,
          description: description.trim(),
        }),
      });
      onCreated(created);
    } catch (err) {
      onError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Create workspace" onClose={onClose}>
      <Field label="Name (slug)">
        <input
          autoFocus
          value={name}
          onChange={(e) =>
            setName(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ""))
          }
          placeholder="e.g. client-acme"
          style={modalInputStyle}
        />
      </Field>
      <Field label="Display name">
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Acme Corp"
          style={modalInputStyle}
        />
      </Field>
      <Field label="Type">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={modalInputStyle}
        >
          {NS_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Optional description"
          style={{
            ...modalInputStyle,
            resize: "vertical",
            fontFamily: "var(--font-plex-sans)",
          }}
        />
      </Field>
      <ModalFooter
        primaryLabel={busy ? "Creating…" : "Create"}
        primaryDisabled={busy || !name.trim()}
        onPrimary={submit}
        onCancel={onClose}
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

function DeleteDialog({
  target,
  confirm,
  setConfirm,
  busy,
  onConfirm,
  onCancel,
}: {
  target: Namespace;
  confirm: string;
  setConfirm: (s: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={`Permanently delete "${target.display_name || target.name}"?`}
      onClose={onCancel}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          lineHeight: 1.55,
          color: "var(--ink-dim)",
        }}
      >
        This cannot be undone. All workspace data, member grants, and audit
        history will be permanently removed.
      </p>
      <Field label="Type CONFIRM to proceed">
        <input
          autoFocus
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="CONFIRM"
          style={modalInputStyle}
        />
      </Field>
      <ModalFooter
        primaryLabel={busy ? "Deleting…" : "Delete permanently"}
        primaryDisabled={busy || confirm !== "CONFIRM"}
        primaryTone="danger"
        onPrimary={onConfirm}
        onCancel={onCancel}
      />
    </Modal>
  );
}
