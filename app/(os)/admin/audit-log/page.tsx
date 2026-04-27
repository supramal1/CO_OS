"use client";

import { useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/lib/admin-api";
import type {
  AuditEvent,
  Namespace,
  Principal,
} from "@/lib/admin-types";
import { StatusPill } from "@/components/admin/status-pill";
import { Empty } from "@/components/admin/modal";

type ListState =
  | { status: "loading" }
  | { status: "loaded"; events: AuditEvent[] }
  | { status: "error"; message: string };

type NamespacesState =
  | { status: "loading" }
  | { status: "loaded"; namespaces: Namespace[] }
  | { status: "error" };

type Decision = "all" | "allow" | "deny";
type Preset = "all" | "status_changes";

const PAGE_SIZE = 25;
const FETCH_LIMIT = 500;

const ENDPOINT_LABELS: Record<string, string> = {
  "GET /connection/workspaces": "Viewed workspaces",
  "GET /connection/verify": "Verified connection",
  "POST /memory/fact": "Saved a fact",
  "POST /memory/notes": "Saved a note",
  "DELETE /memory/notes": "Deleted a note",
  "POST /context": "Retrieved context",
  "POST /ingest": "Processed conversation",
  "GET /memory/facts": "Viewed facts",
  "GET /memory/notes": "Viewed notes",
  "GET /admin/namespaces": "Viewed workspaces",
  "POST /admin/namespaces": "Created workspace",
  "POST /admin/credentials": "Created credentials",
  "GET /admin/principals": "Viewed users",
  "POST /admin/principals": "Created user",
  "GET /admin/status": "Checked system status",
  "GET /admin/audit": "Viewed activity",
  "POST /admin/bootstrap": "Set up access control",
  "DELETE /admin/namespaces": "Archived workspace",
  "GET /memory/recent": "Viewed recent memory",
  "GET /memory/documents": "Viewed documents",
  "DELETE /memory/documents": "Deleted document",
  "POST /memory/search": "Searched memory",
};

// Cornerstone audit emits `action="admin"` for any /admin/* path (api/auth.py
// _classify_action), so HTTP verbs aren't recoverable from the action field.
// Lifecycle events are disambiguated by raw-path regex against the original
// endpoint (BEFORE UUID stripping) plus explicit handler-emitted action values.
const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const INVITATION_REVOKE_RE = new RegExp(
  `^/admin/invitations/${UUID_PATTERN}/?$`,
  "i",
);
const INVITATION_RESEND_RE = new RegExp(
  `^/admin/invitations/${UUID_PATTERN}/resend/?$`,
  "i",
);

// Handler-emitted lifecycle action values (api/routes/admin.py:907 pattern).
// Parallel to the generic middleware emitter; carry meaningful action names.
const LIFECYCLE_ACTIONS: Record<string, string> = {
  principal_archived: "User archived",
  principal_deleted: "User deleted",
  principal_unarchived: "User unarchived",
};

const UUID_RE =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function rawPath(endpoint: string): string {
  return endpoint.split("?")[0];
}

function cleanPath(path: string): string {
  return path.split("?")[0].replace(UUID_RE, "").replace(/\/+$/, "");
}

function translateEndpoint(action: string, endpoint: string): string {
  // Override 1: handler-emitted lifecycle action values.
  const lifecycle = LIFECYCLE_ACTIONS[action];
  if (lifecycle) return lifecycle;

  // Override 2: invitation lifecycle, disambiguated by raw path.
  // (cleanPath collapses DELETE/{id} and GET list to the same key, so we
  // pattern-match against the original UUID-bearing path instead.)
  const path = rawPath(endpoint);
  if (INVITATION_RESEND_RE.test(path)) return "Invitation resent";
  if (INVITATION_REVOKE_RE.test(path)) return "Invitation revoked";

  // Generic fallback via ENDPOINT_LABELS.
  const key = `${action} ${cleanPath(endpoint)}`;
  return ENDPOINT_LABELS[key] || `${action} ${cleanPath(endpoint)}`;
}

function isStatusChange(ev: AuditEvent): boolean {
  // Handler-emitted lifecycle events (action carries the verb directly).
  if (ev.action in LIFECYCLE_ACTIONS) return true;

  // Middleware-emitted events: disambiguate by raw-path pattern against
  // the original endpoint (UUIDs preserved). Covers principal/credential/
  // namespace status flips and invitation revoke/resend.
  const path = rawPath(ev.endpoint);
  if (/\/status\/?$/.test(path)) return true;
  if (INVITATION_RESEND_RE.test(path)) return true;
  if (INVITATION_REVOKE_RE.test(path)) return true;
  return false;
}

function displayPrincipal(
  principalId: string | null,
  principalMap: Map<string, Principal>,
): string {
  if (!principalId) return "System";
  const p = principalMap.get(principalId);
  if (p) return p.email || p.name;
  return "API key";
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const WORKSPACE_ALL = "__all__";

export default function AdminAuditLogPage() {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [nsState, setNsState] = useState<NamespacesState>({ status: "loading" });
  const [decision, setDecision] = useState<Decision>("all");
  const [preset, setPreset] = useState<Preset>("all");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [principalMap, setPrincipalMap] = useState<Map<string, Principal>>(
    new Map(),
  );

  useEffect(() => {
    void adminFetch<Principal[]>("/admin/principals")
      .then((list) => {
        const map = new Map<string, Principal>();
        for (const p of list) map.set(p.id, p);
        setPrincipalMap(map);
      })
      .catch(() => {
        /* non-critical */
      });
    void adminFetch<Namespace[]>("/admin/namespaces?include_archived=true")
      .then((namespaces) => {
        setNsState({ status: "loaded", namespaces });
        setWorkspace((cur) => {
          if (cur !== null) return cur;
          const firstActive =
            namespaces.find((n) => n.status === "active") ?? namespaces[0];
          return firstActive ? firstActive.name : WORKSPACE_ALL;
        });
      })
      .catch(() => {
        setNsState({ status: "error" });
        setWorkspace(WORKSPACE_ALL);
      });
  }, []);

  useEffect(() => {
    if (workspace === null) return;
    let cancelled = false;
    setState({ status: "loading" });
    const params = new URLSearchParams();
    if (decision !== "all") params.set("decision", decision);
    // Status-changes preset spans admin-context events whose audit rows
    // carry namespace=NULL (e.g. invitation revoke/resend, principal-status
    // flips). Scoping the fetch to a workspace would hide them. When the
    // preset is active, fetch globally and let the client-side filter narrow.
    if (workspace !== WORKSPACE_ALL && preset !== "status_changes") {
      params.set("namespace", workspace);
    }
    params.set("limit", String(FETCH_LIMIT));
    adminFetch<AuditEvent[]>(`/admin/audit?${params}`)
      .then((events) => {
        if (!cancelled) setState({ status: "loaded", events });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "failed to load",
          });
        }
      });
    setPage(1);
    return () => {
      cancelled = true;
    };
  }, [decision, workspace, preset]);

  const allEvents = state.status === "loaded" ? state.events : [];
  const namespaces = nsState.status === "loaded" ? nsState.namespaces : [];

  const filtered = useMemo(() => {
    if (preset === "status_changes") return allEvents.filter(isStatusChange);
    return allEvents;
  }, [allEvents, preset]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageEvents = filtered.slice(pageStart, pageStart + PAGE_SIZE);

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
        total={allEvents.length}
        showing={filtered.length}
        loading={state.status === "loading"}
      />

      <Toolbar
        decision={decision}
        setDecision={(d) => {
          setDecision(d);
          setPage(1);
        }}
        preset={preset}
        setPreset={(p) => {
          setPreset(p);
          setPage(1);
        }}
        workspace={workspace ?? WORKSPACE_ALL}
        setWorkspace={(w) => {
          setWorkspace(w);
          setPage(1);
        }}
        namespaces={namespaces}
      />

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {state.status === "loading" ? (
          <Empty>Loading activity…</Empty>
        ) : state.status === "error" ? (
          <Empty>Couldn&rsquo;t load — {state.message}</Empty>
        ) : pageEvents.length === 0 ? (
          <Empty>
            {preset === "status_changes" || decision !== "all"
              ? "No activity matches the current filters."
              : "No activity recorded yet."}
          </Empty>
        ) : (
          <EventTable events={pageEvents} principalMap={principalMap} />
        )}
      </div>

      {filtered.length > 0 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}

function Header({
  total,
  showing,
  loading,
}: {
  total: number;
  showing: number;
  loading: boolean;
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
          Admin · audit log
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
          Activity
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
        {loading ? (
          <span>Loading…</span>
        ) : (
          <>
            <span>
              <span style={{ color: "var(--ink)" }}>{showing}</span> showing
            </span>
            {showing !== total ? (
              <>
                <span style={{ color: "var(--ink-faint)" }}>·</span>
                <span>
                  <span style={{ color: "var(--ink)" }}>{total}</span> total
                </span>
              </>
            ) : null}
          </>
        )}
      </div>
    </header>
  );
}

function Toolbar({
  decision,
  setDecision,
  preset,
  setPreset,
  workspace,
  setWorkspace,
  namespaces,
}: {
  decision: Decision;
  setDecision: (d: Decision) => void;
  preset: Preset;
  setPreset: (p: Preset) => void;
  workspace: string;
  setWorkspace: (w: string) => void;
  namespaces: Namespace[];
}) {
  return (
    <div
      style={{
        padding: "10px 28px",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <ChipGroup label="Decision">
        <Chip
          active={decision === "all"}
          onClick={() => setDecision("all")}
          label="All"
        />
        <Chip
          active={decision === "allow"}
          onClick={() => setDecision("allow")}
          label="Allow"
        />
        <Chip
          active={decision === "deny"}
          onClick={() => setDecision("deny")}
          label="Deny"
        />
      </ChipGroup>

      <ChipGroup label="Preset">
        <Chip
          active={preset === "all"}
          onClick={() => setPreset("all")}
          label="All events"
        />
        <Chip
          active={preset === "status_changes"}
          onClick={() => setPreset("status_changes")}
          label="Status changes"
        />
      </ChipGroup>

      <div style={{ flex: 1 }} />

      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        <span>Workspace</span>
        <select
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 12,
            padding: "5px 8px",
            background: "var(--bg)",
            color: "var(--ink)",
            border: "1px solid var(--rule)",
          }}
        >
          <option value={WORKSPACE_ALL}>All workspaces</option>
          {namespaces.map((n) => (
            <option key={n.id} value={n.name}>
              {n.display_name || n.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ChipGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: 4 }}>{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        letterSpacing: "0.08em",
        padding: "5px 10px",
        background: active ? "var(--ink)" : "transparent",
        color: active ? "var(--panel)" : "var(--ink-dim)",
        border: `1px solid ${active ? "var(--ink)" : "var(--rule)"}`,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function EventTable({
  events,
  principalMap,
}: {
  events: AuditEvent[];
  principalMap: Map<string, Principal>;
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
          <Th>Action</Th>
          <Th>Decision</Th>
          <Th>Workspace</Th>
          <Th>Actor</Th>
          <Th align="right">When</Th>
        </tr>
      </thead>
      <tbody>
        {events.map((ev) => (
          <tr
            key={ev.id}
            style={{ borderBottom: "1px solid var(--rule)" }}
          >
            <Td>
              <div
                style={{ color: "var(--ink)", fontWeight: 500 }}
                title={`${ev.action} ${ev.endpoint}`}
              >
                {translateEndpoint(ev.action, ev.endpoint)}
              </div>
              {ev.reason ? (
                <div
                  style={{
                    color: "var(--ink-dim)",
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  {ev.reason}
                </div>
              ) : null}
            </Td>
            <Td>
              <StatusPill status={ev.decision} />
            </Td>
            <Td>
              <span
                style={{
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 12,
                  color: ev.namespace ? "var(--ink)" : "var(--ink-faint)",
                }}
              >
                {ev.namespace || "—"}
              </span>
            </Td>
            <Td>
              <span style={{ color: "var(--ink)" }}>
                {displayPrincipal(ev.principal_id, principalMap)}
              </span>
            </Td>
            <Td align="right">
              <span
                style={{
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 11,
                  color: "var(--ink-dim)",
                }}
              >
                {formatDateTime(ev.created_at)}
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "10px 16px",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--ink-faint)",
        fontWeight: 400,
        borderBottom: "1px solid var(--rule-2)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "10px 16px",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}

function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div
      style={{
        padding: "10px 28px",
        borderTop: "1px solid var(--rule)",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 12,
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        color: "var(--ink-dim)",
      }}
    >
      <span>
        Page <span style={{ color: "var(--ink)" }}>{page}</span> of{" "}
        <span style={{ color: "var(--ink)" }}>{totalPages}</span>
      </span>
      <button
        type="button"
        onClick={onPrev}
        disabled={page <= 1}
        style={pagerBtn(page <= 1)}
      >
        ← Prev
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= totalPages}
        style={pagerBtn(page >= totalPages)}
      >
        Next →
      </button>
    </div>
  );
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.08em",
    padding: "4px 10px",
    background: "transparent",
    color: disabled ? "var(--ink-faint)" : "var(--ink)",
    border: "1px solid var(--rule)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
