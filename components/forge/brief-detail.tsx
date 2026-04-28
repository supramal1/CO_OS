"use client";

import { useState } from "react";
import type { Brief, BriefStatus } from "@/lib/forge-types";
import { BRIEF_STATUSES, STATUS_LABEL, URGENCY_LABEL } from "@/lib/forge-types";
import { linkedTaskIds } from "@/lib/forge-brief-promotion";

type Props = {
  brief: Brief;
  isAdmin: boolean;
  onUpdated: (next: Brief) => void;
  onError: (message: string) => void;
};

export function BriefDetail({ brief, isAdmin, onUpdated, onError }: Props) {
  const [saving, setSaving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [adminNotes, setAdminNotes] = useState(brief.admin_notes ?? "");
  const [resolution, setResolution] = useState(brief.resolution ?? "");
  const taskIds = linkedTaskIds(brief);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/forge/briefs/${brief.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, namespace: brief.namespace }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `status ${res.status}`);
      }
      const next = (await res.json()) as Brief;
      onUpdated(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : "update failed");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = (status: BriefStatus) => patch({ status });
  const saveNotes = () =>
    patch({
      admin_notes: adminNotes || null,
      resolution: resolution || null,
    });
  const promoteToBacklog = async () => {
    setPromoting(true);
    try {
      const res = await fetch(`/api/forge/briefs/${brief.id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ namespace: brief.namespace }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        brief?: Brief;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.brief) {
        throw new Error(data.detail ?? data.error ?? `status ${res.status}`);
      }
      onUpdated(data.brief);
    } catch (err) {
      onError(err instanceof Error ? err.message : "promotion failed");
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "auto",
      }}
    >
      <div
        style={{
          padding: "24px 28px 18px",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            marginBottom: 10,
          }}
        >
          Brief · {brief.id.slice(0, 8)}
        </div>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-plex-serif)",
            fontSize: 24,
            fontWeight: 400,
            color: "var(--ink)",
            lineHeight: 1.2,
          }}
        >
          {brief.title}
        </h2>
        <div
          style={{
            marginTop: 8,
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
          }}
        >
          {brief.namespace}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          padding: "18px 28px",
          gap: "16px 32px",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <Field label="Status" value={STATUS_LABEL[brief.status]} />
        <Field
          label="Urgency"
          value={brief.urgency ? URGENCY_LABEL[brief.urgency] : "—"}
        />
        <Field label="Frequency" value={brief.frequency ?? "—"} />
        <Field
          label="Time cost"
          value={
            brief.time_cost_minutes != null
              ? `${brief.time_cost_minutes} min`
              : "—"
          }
        />
        <Field label="Scope" value={brief.affected_scope ?? "—"} />
        <Field
          label="Updated"
          value={new Date(brief.updated_at).toLocaleString()}
        />
      </div>

      <Section title="Problem">{brief.problem_statement}</Section>
      {brief.desired_outcome ? (
        <Section title="Desired outcome">{brief.desired_outcome}</Section>
      ) : null}

      {isAdmin ? (
        <div
          style={{
            padding: "18px 28px 24px",
            borderTop: "1px solid var(--rule)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-plex-mono)",
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            Admin
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {BRIEF_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                disabled={saving || s === brief.status}
                style={{
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "6px 10px",
                  background:
                    s === brief.status ? "var(--ink)" : "transparent",
                  color: s === brief.status ? "var(--panel)" : "var(--ink)",
                  border: "1px solid var(--rule)",
                  cursor:
                    saving || s === brief.status ? "default" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          <div
            style={{
              border: "1px solid var(--rule)",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              background: "var(--panel-2)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-plex-mono)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--ink-faint)",
              }}
            >
              Backlog task
            </div>
            {taskIds.length > 0 ? (
              <div
                style={{
                  fontFamily: "var(--font-plex-mono)",
                  fontSize: 11,
                  color: "var(--ink-dim)",
                  wordBreak: "break-word",
                }}
              >
                Linked task {taskIds.join(", ")}
              </div>
            ) : (
              <>
                <p
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-plex-sans)",
                    fontSize: 13,
                    color: "var(--ink-dim)",
                    lineHeight: 1.45,
                  }}
                >
                  Create a Forge task in Backlog from this brief so it can move
                  through the kanban.
                </p>
                <button
                  type="button"
                  onClick={promoteToBacklog}
                  disabled={saving || promoting || brief.status === "rejected"}
                  style={{
                    alignSelf: "flex-start",
                    fontFamily: "var(--font-plex-mono)",
                    fontSize: 11,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    padding: "8px 14px",
                    background: "transparent",
                    color: "var(--ink)",
                    border: "1px solid var(--ink)",
                    cursor:
                      saving || promoting || brief.status === "rejected"
                        ? "default"
                        : "pointer",
                    opacity:
                      saving || promoting || brief.status === "rejected"
                        ? 0.6
                        : 1,
                  }}
                >
                  {promoting ? "Sending..." : "Send to backlog"}
                </button>
              </>
            )}
          </div>

          <LabeledTextarea
            label="Admin notes"
            value={adminNotes}
            onChange={setAdminNotes}
          />
          <LabeledTextarea
            label="Resolution"
            value={resolution}
            onChange={setResolution}
          />
          <button
            type="button"
            onClick={saveNotes}
            disabled={saving}
            style={{
              alignSelf: "flex-start",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "8px 14px",
              background: "var(--ink)",
              color: "var(--panel)",
              border: "1px solid var(--ink)",
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : "Save notes"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          color: "var(--ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ padding: "18px 28px", borderBottom: "1px solid var(--rule)" }}>
      <div
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          color: "var(--ink)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        style={{
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          color: "var(--ink)",
          background: "var(--panel)",
          border: "1px solid var(--rule)",
          padding: "10px 12px",
          resize: "vertical",
        }}
      />
    </label>
  );
}
