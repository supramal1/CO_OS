"use client";

import { useEffect, useMemo, useState } from "react";
import { StatusPill } from "@/components/admin/status-pill";
import type { DeckTemplate } from "@/lib/deck/template-types";

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; templates: DeckTemplate[] }
  | { status: "error"; message: string };

export function DeckTemplateManager() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/deck/templates", { cache: "no-store" });
      const body = (await res.json()) as {
        templates?: DeckTemplate[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "template_load_failed");
      setState({ status: "loaded", templates: body.templates ?? [] });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "template_load_failed",
      });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const templates = useMemo(
    () => (state.status === "loaded" ? state.templates : []),
    [state],
  );
  const activeCount = templates.filter((t) => t.status === "active").length;
  const defaultTemplate = templates.find((t) => t.is_default);
  const sorted = useMemo(
    () =>
      [...templates].sort((a, b) => {
        if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [templates],
  );

  const runAction = async (
    template: DeckTemplate,
    action: "set-default" | "archive" | "test-copy",
  ) => {
    if (
      action === "archive" &&
      !window.confirm(`Archive ${template.name}? Deck runs will stop using it.`)
    ) {
      return;
    }
    setBusyId(template.id);
    setToast(null);
    try {
      const res = await fetch(`/api/deck/templates/${template.id}/${action}`, {
        method: "POST",
      });
      const body = (await res.json()) as {
        error?: string;
        webUrl?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `${action}_failed`);
      setToast(
        action === "test-copy" && body.webUrl
          ? `Test copy created: ${body.webUrl}`
          : "Template updated",
      );
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : `${action}_failed`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main style={{ padding: 28, display: "grid", gap: 18 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "flex-end",
        }}
      >
        <div>
          <p
            style={{
              margin: "0 0 8px",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-dim)",
            }}
          >
            Admin
          </p>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 520 }}>
            Deck templates
          </h1>
        </div>
        <div style={{ textAlign: "right", color: "var(--ink-dim)", fontSize: 13 }}>
          <div>{activeCount} active</div>
          <div>Default: {defaultTemplate?.name ?? "Not set"}</div>
        </div>
      </header>

      {toast ? (
        <div
          role="status"
          style={{
            border: "1px solid var(--rule)",
            padding: "10px 12px",
            fontSize: 13,
            color: "var(--ink)",
            overflowWrap: "anywhere",
          }}
        >
          {toast}
        </div>
      ) : null}

      {state.status === "loading" ? (
        <p style={{ color: "var(--ink-dim)" }}>Loading templates...</p>
      ) : state.status === "error" ? (
        <p style={{ color: "var(--c-forge)" }}>{state.message}</p>
      ) : sorted.length === 0 ? (
        <p style={{ color: "var(--ink-dim)" }}>
          No deck templates registered yet.
        </p>
      ) : (
        <div style={{ overflowX: "auto", borderTop: "1px solid var(--rule)" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              minWidth: 980,
            }}
          >
            <thead>
              <tr style={{ color: "var(--ink-dim)", textAlign: "left" }}>
                <Th>Name</Th>
                <Th>Client</Th>
                <Th>Use case</Th>
                <Th>Status</Th>
                <Th>Runtime</Th>
                <Th>Updated</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((template) => (
                <tr key={template.id} style={{ borderTop: "1px solid var(--rule)" }}>
                  <Td>
                    <strong>{template.name}</strong>
                    {template.is_default ? (
                      <span style={{ marginLeft: 8 }}>
                        <StatusPill label="Default" tone="info" />
                      </span>
                    ) : null}
                  </Td>
                  <Td>{template.client ?? template.brand ?? "General"}</Td>
                  <Td>{template.use_case}</Td>
                  <Td>
                    <StatusPill status={template.status} />
                  </Td>
                  <Td>
                    {template.google_slides_template_url ? (
                      <a
                        href={template.google_slides_template_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Slides template
                      </a>
                    ) : (
                      <span style={{ color: "var(--c-forge)" }}>
                        Google Slides ID missing
                      </span>
                    )}
                  </Td>
                  <Td>{formatDate(template.updated_at)}</Td>
                  <Td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => void runAction(template, "test-copy")}
                        disabled={busyId === template.id}
                      >
                        Test copy
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAction(template, "set-default")}
                        disabled={
                          busyId === template.id ||
                          template.is_default ||
                          template.status !== "active"
                        }
                      >
                        Set default
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAction(template, "archive")}
                        disabled={busyId === template.id || template.status === "archived"}
                      >
                        Archive
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "10px 8px",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "12px 8px", verticalAlign: "top" }}>{children}</td>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
