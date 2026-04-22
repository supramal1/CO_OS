"use client";

import { useEffect, useState, type ComponentPropsWithoutRef, type PointerEvent as ReactPointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SkillDetail as SkillDetailType } from "@/lib/cookbook-types";

type DetailState =
  | { status: "loading" }
  | { status: "loaded"; skill: SkillDetailType }
  | { status: "error"; message: string };

export function SkillDetail({
  skillName,
  refreshKey,
  isAdmin,
  onClose,
  onResizeStart,
  onEdit,
  onDelete,
}: {
  skillName: string;
  refreshKey?: number;
  isAdmin: boolean;
  onClose: () => void;
  onResizeStart: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [state, setState] = useState<DetailState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/cookbook/skills/${encodeURIComponent(skillName)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body?.error ?? `status ${res.status}`);
        }
        const data = (await res.json()) as { skill: SkillDetailType };
        if (!cancelled) setState({ status: "loaded", skill: data.skill });
      } catch (err) {
        const message = err instanceof Error ? err.message : "load failed";
        if (!cancelled) setState({ status: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [skillName, refreshKey]);

  return (
    <aside
      style={{
        position: "relative",
        borderLeft: "1px solid var(--rule)",
        background: "var(--panel)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize detail panel"
        onPointerDown={onResizeStart}
        style={{
          position: "absolute",
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "ew-resize",
          zIndex: 2,
          background: "transparent",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--c-cookbook)";
          e.currentTarget.style.opacity = "0.35";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.opacity = "1";
        }}
      />
      <header
        style={{
          padding: "16px 24px 14px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
          }}
        >
          Skill
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isAdmin && state.status === "loaded" && (
            <div style={{ display: "flex", gap: 6 }}>
              <AdminButton label="Edit" onClick={onEdit} />
              <AdminButton label="Delete" onClick={onDelete} tone="danger" />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            style={{
              color: "var(--ink-dim)",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 14,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
      </header>

      {state.status === "loading" && (
        <div style={{ padding: "20px 24px" }}>
          <p style={mutedStyle}>Loading…</p>
        </div>
      )}

      {state.status === "error" && (
        <div style={{ padding: "20px 24px" }}>
          <p style={{ ...mutedStyle, color: "var(--c-forge)" }}>
            Couldn&apos;t load skill — {state.message}
          </p>
        </div>
      )}

      {state.status === "loaded" && (
        <div style={{ padding: "20px 24px", flex: 1 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-plex-serif)",
              fontSize: 22,
              fontWeight: 400,
              color: "var(--ink)",
              lineHeight: 1.2,
            }}
          >
            {state.skill.name}
          </h2>

          <dl
            style={{
              margin: "18px 0 0",
              display: "grid",
              gridTemplateColumns: "90px 1fr",
              rowGap: 8,
              fontSize: 11.5,
            }}
          >
            <Meta label="Scope" value={scopeLabel(state.skill)} />
            <Meta label="Owner" value={state.skill.owner || "—"} />
            <Meta label="Version" value={state.skill.version} />
            <Meta
              label="Reviewed"
              value={state.skill.last_reviewed || "—"}
            />
          </dl>

          <Section label="Description">
            <Markdown source={state.skill.description} />
          </Section>

          <Section label="Content">
            <Markdown source={state.skill.content} />
          </Section>

          <Section label="Tags">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {state.skill.tags.map((t) => (
                <span
                  key={t}
                  style={{
                    fontFamily: "var(--font-plex-mono)",
                    fontSize: 10,
                    color: "var(--ink-dim)",
                    border: "1px solid var(--rule-2)",
                    padding: "2px 6px",
                    letterSpacing: "0.04em",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </Section>

        </div>
      )}
    </aside>
  );
}

function Markdown({ source }: { source: string }) {
  return (
    <div style={bodyStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

const markdownComponents: Parameters<typeof ReactMarkdown>[0]["components"] = {
  h1: (props: ComponentPropsWithoutRef<"h1">) => (
    <h3 style={headingStyle(16)} {...props} />
  ),
  h2: (props: ComponentPropsWithoutRef<"h2">) => (
    <h3 style={headingStyle(15)} {...props} />
  ),
  h3: (props: ComponentPropsWithoutRef<"h3">) => (
    <h3 style={headingStyle(14)} {...props} />
  ),
  h4: (props: ComponentPropsWithoutRef<"h4">) => (
    <h4 style={headingStyle(13)} {...props} />
  ),
  h5: (props: ComponentPropsWithoutRef<"h5">) => (
    <h5 style={headingStyle(12)} {...props} />
  ),
  h6: (props: ComponentPropsWithoutRef<"h6">) => (
    <h6 style={headingStyle(12)} {...props} />
  ),
  p: (props: ComponentPropsWithoutRef<"p">) => (
    <p
      style={{ margin: "0 0 10px", lineHeight: 1.6, color: "var(--ink)" }}
      {...props}
    />
  ),
  ul: (props: ComponentPropsWithoutRef<"ul">) => (
    <ul
      style={{ margin: "0 0 10px", paddingLeft: 18, lineHeight: 1.55 }}
      {...props}
    />
  ),
  ol: (props: ComponentPropsWithoutRef<"ol">) => (
    <ol
      style={{ margin: "0 0 10px", paddingLeft: 18, lineHeight: 1.55 }}
      {...props}
    />
  ),
  li: (props: ComponentPropsWithoutRef<"li">) => (
    <li style={{ marginBottom: 4 }} {...props} />
  ),
  strong: (props: ComponentPropsWithoutRef<"strong">) => (
    <strong style={{ color: "var(--ink)", fontWeight: 600 }} {...props} />
  ),
  em: (props: ComponentPropsWithoutRef<"em">) => (
    <em style={{ color: "var(--ink)", fontStyle: "italic" }} {...props} />
  ),
  code: (props: ComponentPropsWithoutRef<"code">) => (
    <code
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 12,
        background: "var(--panel-2)",
        border: "1px solid var(--rule)",
        padding: "1px 5px",
      }}
      {...props}
    />
  ),
  pre: (props: ComponentPropsWithoutRef<"pre">) => (
    <pre
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 12,
        background: "var(--panel-2)",
        border: "1px solid var(--rule)",
        padding: "10px 12px",
        overflowX: "auto",
        margin: "0 0 12px",
        lineHeight: 1.5,
      }}
      {...props}
    />
  ),
  a: (props: ComponentPropsWithoutRef<"a">) => (
    <a
      style={{ color: "var(--c-cookbook)", textDecoration: "underline" }}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote
      style={{
        margin: "0 0 10px",
        paddingLeft: 12,
        borderLeft: "2px solid var(--rule-2)",
        color: "var(--ink-dim)",
      }}
      {...props}
    />
  ),
  hr: () => (
    <hr
      style={{
        border: 0,
        borderTop: "1px solid var(--rule)",
        margin: "14px 0",
      }}
    />
  ),
};

function headingStyle(fontSize: number): React.CSSProperties {
  return {
    margin: "14px 0 6px",
    fontFamily: "var(--font-plex-sans)",
    fontSize,
    fontWeight: 600,
    color: "var(--ink)",
    lineHeight: 1.3,
  };
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          alignSelf: "center",
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 12.5,
          color: "var(--ink)",
        }}
      >
        {value}
      </dd>
    </>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 22 }}>
      <div
        style={{
          display: "inline-block",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--c-cookbook)",
          border: "1px solid var(--c-cookbook)",
          background: "color-mix(in srgb, var(--c-cookbook) 10%, transparent)",
          padding: "2px 8px",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const bodyStyle: React.CSSProperties = {
  fontFamily: "var(--font-plex-sans)",
  fontSize: 13,
  color: "var(--ink)",
  lineHeight: 1.6,
  wordBreak: "break-word",
};

const mutedStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-plex-sans)",
  fontSize: 13,
  color: "var(--ink-faint)",
  lineHeight: 1.55,
};

function AdminButton({
  label,
  onClick,
  tone = "default",
}: {
  label: string;
  onClick?: () => void;
  tone?: "default" | "danger";
}) {
  const hoverColor =
    tone === "danger" ? "var(--c-forge)" : "var(--c-cookbook)";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 10px",
        border: "1px solid var(--rule-2)",
        color: "var(--ink-dim)",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        background: "transparent",
        cursor: "pointer",
        transition: "color 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = hoverColor;
        e.currentTarget.style.borderColor = hoverColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--ink-dim)";
        e.currentTarget.style.borderColor = "var(--rule-2)";
      }}
    >
      {label}
    </button>
  );
}

function scopeLabel(s: { scope_type: string; scope_id: string | null }) {
  if (s.scope_type === "global") return "Global";
  if (s.scope_type === "team") return `Team · ${s.scope_id}`;
  return `Client · ${s.scope_id}`;
}
