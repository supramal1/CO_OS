"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { buildScopeGroups, type SkillSummary } from "@/lib/cookbook-types";
import {
  buildExportZip,
  todayStamp,
  triggerDownload,
  type ExportPayload,
} from "@/lib/cookbook-export-client";
import { ScopeFilter, type ScopeSelection } from "./scope-filter";
import { SkillCard } from "./skill-card";
import { SkillDetail } from "./skill-detail";
import { SkillForm, type SkillFormMode, type SavedSkill } from "./skill-form";
import { ConfirmDelete } from "./confirm-delete";

type Toast =
  | {
      kind: "success" | "error";
      message: string;
      link?: { href: string; label: string };
    }
  | null;

type SkillsState =
  | { status: "loading" }
  | { status: "loaded"; skills: SkillSummary[] }
  | { status: "error"; message: string };

export function CookbookShell() {
  const { data: session } = useSession();
  const isAdmin = session?.isAdmin ?? false;

  const [skillsState, setSkillsState] = useState<SkillsState>({
    status: "loading",
  });
  const [selection, setSelection] = useState<ScopeSelection>({ kind: "all" });
  const [activeName, setActiveName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [detailWidth, setDetailWidth] = useState(420);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [formMode, setFormMode] = useState<SkillFormMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);

  const beginResize = (startX: number, startWidth: number) => {
    const shellEl = shellRef.current;
    const onMove = (clientX: number) => {
      const maxWidth = shellEl
        ? Math.max(320, shellEl.clientWidth - 440)
        : 900;
      const next = Math.min(
        Math.max(320, startWidth + (startX - clientX)),
        maxWidth,
      );
      setDetailWidth(next);
    };
    const onPointerMove = (e: PointerEvent) => onMove(e.clientX);
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };

  const refreshSkills = async () => {
    try {
      const res = await fetch("/api/cookbook/skills", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body?.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as { skills: SkillSummary[] };
      setSkillsState({ status: "loaded", skills: data.skills ?? [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "load failed";
      setSkillsState({ status: "error", message });
    }
  };

  useEffect(() => {
    refreshSkills();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const ttl = toast.link ? 10000 : 3200;
    const id = window.setTimeout(() => setToast(null), ttl);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/cookbook/export", { method: "POST" });
      if (!res.ok) {
        let detail = `status ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) detail = body.error;
        } catch {
          /* noop */
        }
        throw new Error(detail);
      }
      const payload = (await res.json()) as ExportPayload;
      const zip = await buildExportZip(payload);
      triggerDownload(zip, `co-cookbook-export-${todayStamp()}.zip`);
      setToast({ kind: "success", message: `Downloaded ${payload.count} skills` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed";
      setToast({ kind: "error", message: `Download failed — ${message}` });
    } finally {
      setExporting(false);
    }
  };

  const handlePushToGit = async () => {
    if (pushing) return;
    setPushing(true);
    try {
      const res = await fetch("/api/cookbook/git-push", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        pr_url?: string;
        pr_number?: number;
        skill_count?: number;
      };
      if (!res.ok) {
        throw new Error(body?.error ?? `status ${res.status}`);
      }
      setToast({
        kind: "success",
        message: `PR #${body.pr_number} opened — ${body.skill_count} skills`,
        link: body.pr_url
          ? { href: body.pr_url, label: "View PR" }
          : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Push failed";
      setToast({ kind: "error", message: `Push failed — ${message}` });
    } finally {
      setPushing(false);
    }
  };

  const skills = skillsState.status === "loaded" ? skillsState.skills : [];

  const groups = useMemo(() => buildScopeGroups(skills), [skills]);

  const filtered = useMemo(() => {
    let list = skills;
    if (selection.kind === "scope") {
      list = list.filter((s) => {
        if (s.scope_type !== selection.scopeType) return false;
        if (selection.scopeType === "global") return true;
        return s.scope_id === selection.scopeId;
      });
    }
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [selection, query, skills]);

  const activeSkill = activeName
    ? skills.find((s) => s.name === activeName) ?? null
    : null;

  return (
    <div
      ref={shellRef}
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "grid",
        gridTemplateColumns: activeSkill
          ? `200px minmax(0, 1fr) ${detailWidth}px`
          : "200px minmax(0, 1fr)",
        minHeight: 0,
      }}
    >
      <ScopeFilter
        groups={groups}
        selection={selection}
        onSelect={(s) => {
          setSelection(s);
          setActiveName(null);
        }}
        totalCount={skills.length}
      />

      <section
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "22px 32px 18px",
            borderBottom: "1px solid var(--rule)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-plex-mono)",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--c-cookbook)",
                marginBottom: 4,
              }}
            >
              Module · Cookbook
            </div>
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-plex-serif)",
                fontSize: 28,
                fontWeight: 400,
                color: "var(--ink)",
                letterSpacing: "-0.005em",
              }}
            >
              {selectionLabel(selection)}
            </h1>
            <p
              style={{
                margin: "6px 0 0",
                fontFamily: "var(--font-plex-sans)",
                fontSize: 13,
                color: "var(--ink-dim)",
                maxWidth: 520,
              }}
            >
              Curated, repeatable skills the team uses to work on brand.
              Markdown at source, rendered here for quick reference.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills"
              style={{
                width: 220,
                background: "var(--panel-2)",
                border: "1px solid var(--rule)",
                color: "var(--ink)",
                fontFamily: "var(--font-plex-sans)",
                fontSize: 12,
                padding: "7px 10px",
              }}
            />
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting}
                  style={{
                    padding: "7px 12px",
                    border: "1px solid var(--rule)",
                    background: "var(--panel)",
                    color: "var(--ink-dim)",
                    fontFamily: "var(--font-plex-mono)",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    cursor: exporting ? "default" : "pointer",
                    opacity: exporting ? 0.6 : 1,
                    transition: "color 120ms ease, border-color 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    if (exporting) return;
                    e.currentTarget.style.color = "var(--ink)";
                    e.currentTarget.style.borderColor = "var(--rule-2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--ink-dim)";
                    e.currentTarget.style.borderColor = "var(--rule)";
                  }}
                >
                  {exporting ? "Downloading…" : "Download zip"}
                </button>
                <button
                  type="button"
                  onClick={handlePushToGit}
                  disabled={pushing}
                  style={{
                    padding: "7px 12px",
                    border: "1px solid var(--c-cookbook)",
                    background: "var(--panel)",
                    color: "var(--c-cookbook)",
                    fontFamily: "var(--font-plex-mono)",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    cursor: pushing ? "default" : "pointer",
                    opacity: pushing ? 0.6 : 1,
                  }}
                >
                  {pushing ? "Pushing…" : "Export to Git"}
                </button>
                <button
                  type="button"
                  onClick={() => setFormMode({ kind: "create" })}
                  style={{
                    padding: "7px 12px",
                    border: "1px solid var(--c-cookbook)",
                    color: "var(--c-cookbook)",
                    fontFamily: "var(--font-plex-mono)",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    background: "transparent",
                  }}
                >
                  + New skill
                </button>
              </>
            )}
          </div>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 32px 40px",
          }}
        >
          {skillsState.status === "loading" && (
            <div style={emptyStateStyle}>Loading skills…</div>
          )}
          {skillsState.status === "error" && (
            <div
              style={{
                ...emptyStateStyle,
                borderColor: "var(--c-forge)",
                color: "var(--c-forge)",
              }}
            >
              Couldn&apos;t load skills — {skillsState.message}
            </div>
          )}
          {skillsState.status === "loaded" &&
            (filtered.length === 0 ? (
              <div style={emptyStateStyle}>No skills match.</div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 14,
                }}
              >
                {filtered.map((s) => (
                  <SkillCard
                    key={s.name}
                    skill={s}
                    active={s.name === activeName}
                    onSelect={() => setActiveName(s.name)}
                  />
                ))}
              </div>
            ))}
        </div>
      </section>

      {activeSkill && (
        <SkillDetail
          key={activeSkill.name}
          skillName={activeSkill.name}
          refreshKey={detailRefreshKey}
          isAdmin={isAdmin}
          onClose={() => setActiveName(null)}
          onResizeStart={(e) => {
            e.preventDefault();
            beginResize(e.clientX, detailWidth);
          }}
          onEdit={() => setFormMode({ kind: "edit", skill: activeSkill })}
          onDelete={() => setDeleteTarget(activeSkill.name)}
        />
      )}

      {formMode && (
        <SkillForm
          mode={formMode}
          onClose={() => setFormMode(null)}
          onSaved={async (saved: SavedSkill) => {
            const wasCreate = formMode.kind === "create";
            setFormMode(null);
            await refreshSkills();
            setDetailRefreshKey((k) => k + 1);

            if (!savedMatchesFilter(saved, selection)) {
              setSelection(
                saved.scope_type === "global"
                  ? { kind: "scope", scopeType: "global", scopeId: null }
                  : { kind: "all" },
              );
            }
            setQuery("");
            setActiveName(saved.name);

            setToast({
              kind: "success",
              message: wasCreate
                ? `Created ${saved.name}`
                : `Updated ${saved.name}`,
            });
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDelete
          name={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onDeleted={async () => {
            const name = deleteTarget;
            setDeleteTarget(null);
            if (activeName === name) setActiveName(null);
            await refreshSkills();
            setToast({ kind: "success", message: `Deleted ${name}` });
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 50,
            background: "var(--panel-2)",
            border: `1px solid ${
              toast.kind === "success" ? "var(--c-cookbook)" : "var(--c-forge)"
            }`,
            padding: "10px 14px",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            color: "var(--ink)",
            maxWidth: 340,
            lineHeight: 1.4,
          }}
        >
          <span
            style={{
              display: "inline-block",
              marginRight: 8,
              color:
                toast.kind === "success"
                  ? "var(--c-cookbook)"
                  : "var(--c-forge)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            {toast.kind === "success" ? "OK" : "ERR"}
          </span>
          {toast.message}
          {toast.link && (
            <>
              {" "}
              <a
                href={toast.link.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--c-cookbook)",
                  textDecoration: "underline",
                  marginLeft: 6,
                }}
              >
                {toast.link.label}
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const emptyStateStyle: React.CSSProperties = {
  border: "1px dashed var(--rule-2)",
  padding: "40px 24px",
  textAlign: "center",
  fontFamily: "var(--font-plex-sans)",
  fontSize: 13,
  color: "var(--ink-faint)",
};

function savedMatchesFilter(
  saved: SavedSkill,
  selection: ScopeSelection,
): boolean {
  if (selection.kind === "all") return true;
  if (saved.scope_type !== selection.scopeType) return false;
  if (selection.scopeType === "global") return true;
  return saved.scope_id === selection.scopeId;
}

function selectionLabel(s: ScopeSelection) {
  if (s.kind === "all") return "All skills";
  if (s.scopeType === "global") return "Global skills";
  if (s.scopeType === "team") return `Team — ${s.scopeId}`;
  return `Client — ${s.scopeId}`;
}
