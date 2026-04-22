"use client";

import { useEffect, useState } from "react";
import type {
  ScopeType,
  SkillDetail,
  SkillSummary,
} from "@/lib/cookbook-types";

export type SkillFormMode =
  | { kind: "create" }
  | { kind: "edit"; skill: SkillSummary };

type FormState = {
  name: string;
  description: string;
  scope_type: ScopeType;
  scope_id: string;
  owner: string;
  version: string;
  tagsInput: string;
  content: string;
};

function emptyState(): FormState {
  return {
    name: "",
    description: "",
    scope_type: "global",
    scope_id: "",
    owner: "",
    version: "1.0.0",
    tagsInput: "",
    content: "",
  };
}

export type SavedSkill = {
  name: string;
  scope_type: ScopeType;
  scope_id: string | null;
};

export function SkillForm({
  mode,
  onClose,
  onSaved,
}: {
  mode: SkillFormMode;
  onClose: () => void;
  onSaved: (saved: SavedSkill) => void;
}) {
  const [form, setForm] = useState<FormState>(emptyState());
  const [loading, setLoading] = useState(mode.kind === "edit");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode.kind !== "edit") return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/cookbook/skills/${encodeURIComponent(mode.skill.name)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body?.error ?? `status ${res.status}`);
        }
        const { skill } = (await res.json()) as { skill: SkillDetail };
        if (cancelled) return;
        setForm({
          name: skill.name,
          description: skill.description ?? "",
          scope_type: skill.scope_type,
          scope_id: skill.scope_id ?? "",
          owner: skill.owner ?? "",
          version: skill.version ?? "1.0.0",
          tagsInput: (skill.tags ?? []).join(", "),
          content: skill.content ?? "",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "load failed";
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const isEdit = mode.kind === "edit";
  const title = isEdit ? `Edit · ${form.name || mode.skill.name}` : "New skill";

  const submit = async () => {
    if (submitting) return;
    setError(null);

    if (!isEdit && !form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!form.description.trim()) {
      setError("Description is required.");
      return;
    }
    if (!form.content.trim()) {
      setError("Content is required.");
      return;
    }
    if (
      (form.scope_type === "team" || form.scope_type === "client") &&
      !form.scope_id.trim()
    ) {
      setError(`Scope id is required for ${form.scope_type} scope.`);
      return;
    }

    const tags = form.tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const scopeId = form.scope_type === "global" ? null : form.scope_id.trim();

    setSubmitting(true);
    try {
      if (isEdit) {
        const res = await fetch(
          `/api/cookbook/skills/${encodeURIComponent(mode.skill.name)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: form.description,
              scope_type: form.scope_type,
              scope_id: scopeId,
              owner: form.owner || null,
              version: form.version || null,
              tags,
              content: form.content,
            }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body?.error ?? `status ${res.status}`);
        }
      } else {
        const res = await fetch("/api/cookbook/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description,
            scope_type: form.scope_type,
            scope_id: scopeId,
            owner: form.owner || undefined,
            version: form.version || undefined,
            tags,
            content: form.content,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body?.error ?? `status ${res.status}`);
        }
      }
      onSaved({
        name: isEdit ? mode.skill.name : form.name.trim(),
        scope_type: form.scope_type,
        scope_id: scopeId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "save failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={overlayStyle}
      onClick={onClose}
    >
      <div
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={headerStyle}>
          <span
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--c-cookbook)",
            }}
          >
            {isEdit ? "Edit skill" : "New skill"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              color: "var(--ink-dim)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 14,
            }}
          >
            ×
          </button>
        </header>

        {loading ? (
          <div style={{ padding: "24px", color: "var(--ink-faint)" }}>
            Loading…
          </div>
        ) : (
          <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
            <Field label="Name">
              <input
                type="text"
                value={form.name}
                onChange={(e) =>
                  setForm((s) => ({ ...s, name: e.target.value }))
                }
                disabled={isEdit}
                placeholder="kebab-case-name"
                style={{
                  ...inputStyle,
                  opacity: isEdit ? 0.6 : 1,
                  cursor: isEdit ? "not-allowed" : "text",
                }}
              />
              {isEdit && (
                <p style={hintStyle}>
                  Name is immutable. Delete + recreate to rename.
                </p>
              )}
            </Field>

            <Field label="Description">
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm((s) => ({ ...s, description: e.target.value }))
                }
                placeholder="When to invoke this skill. Written for the agent."
                rows={3}
                style={{ ...inputStyle, resize: "vertical", minHeight: 64 }}
              />
            </Field>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <Field label="Scope">
                <select
                  value={form.scope_type}
                  onChange={(e) =>
                    setForm((s) => ({
                      ...s,
                      scope_type: e.target.value as ScopeType,
                      scope_id:
                        e.target.value === "global" ? "" : s.scope_id,
                    }))
                  }
                  style={inputStyle}
                >
                  <option value="global">global</option>
                  <option value="team">team</option>
                  <option value="client">client</option>
                </select>
              </Field>
              <Field label="Scope id">
                <input
                  type="text"
                  value={form.scope_id}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, scope_id: e.target.value }))
                  }
                  disabled={form.scope_type === "global"}
                  placeholder={
                    form.scope_type === "global"
                      ? "— (global)"
                      : form.scope_type === "team"
                      ? "ai-ops"
                      : "useful-machines"
                  }
                  style={{
                    ...inputStyle,
                    opacity: form.scope_type === "global" ? 0.5 : 1,
                  }}
                />
              </Field>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <Field label="Owner">
                <input
                  type="text"
                  value={form.owner}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, owner: e.target.value }))
                  }
                  placeholder="ai-ops"
                  style={inputStyle}
                />
              </Field>
              <Field label="Version">
                <input
                  type="text"
                  value={form.version}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, version: e.target.value }))
                  }
                  placeholder="1.0.0"
                  style={inputStyle}
                />
              </Field>
            </div>

            <Field label="Tags">
              <input
                type="text"
                value={form.tagsInput}
                onChange={(e) =>
                  setForm((s) => ({ ...s, tagsInput: e.target.value }))
                }
                placeholder="writing, voice, global"
                style={inputStyle}
              />
              <p style={hintStyle}>Comma separated.</p>
            </Field>

            <Field label="Content (markdown)">
              <textarea
                value={form.content}
                onChange={(e) =>
                  setForm((s) => ({ ...s, content: e.target.value }))
                }
                placeholder="# Heading&#10;&#10;Markdown body here."
                rows={12}
                style={{
                  ...inputStyle,
                  resize: "vertical",
                  minHeight: 220,
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              />
            </Field>

            {error && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  border: "1px solid var(--c-forge)",
                  color: "var(--c-forge)",
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 11,
                  letterSpacing: "0.06em",
                }}
              >
                {error}
              </div>
            )}
          </div>
        )}

        <footer
          style={{
            borderTop: "1px solid var(--rule)",
            padding: "12px 24px",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={secondaryBtn}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || loading}
            style={{
              ...primaryBtn,
              opacity: submitting || loading ? 0.6 : 1,
              cursor: submitting || loading ? "default" : "pointer",
            }}
          >
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create skill"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span
        style={{
          display: "block",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.6)",
  zIndex: 80,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
};

const panelStyle: React.CSSProperties = {
  width: "min(720px, 100%)",
  maxHeight: "calc(100vh - 48px)",
  display: "flex",
  flexDirection: "column",
  background: "var(--panel)",
  border: "1px solid var(--rule-2)",
};

const headerStyle: React.CSSProperties = {
  padding: "14px 24px",
  borderBottom: "1px solid var(--rule)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--panel-2)",
  border: "1px solid var(--rule)",
  color: "var(--ink)",
  fontFamily: "var(--font-plex-sans)",
  fontSize: 13,
  padding: "8px 10px",
  outline: "none",
};

const hintStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontFamily: "var(--font-plex-mono)",
  fontSize: 10,
  color: "var(--ink-faint)",
  letterSpacing: "0.04em",
};

const secondaryBtn: React.CSSProperties = {
  padding: "7px 14px",
  border: "1px solid var(--rule-2)",
  background: "transparent",
  color: "var(--ink-dim)",
  fontFamily: "var(--font-plex-mono)",
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  padding: "7px 14px",
  border: "1px solid var(--c-cookbook)",
  background: "transparent",
  color: "var(--c-cookbook)",
  fontFamily: "var(--font-plex-mono)",
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};
