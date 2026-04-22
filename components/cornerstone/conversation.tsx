"use client";

import { useEffect, useRef } from "react";
import { Message, type ChatMessage } from "./message";
import { Composer } from "./composer";

export function Conversation({
  messages,
  onSend,
  streaming,
  threadTitle,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  streaming: boolean;
  threadTitle: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "var(--bg)",
      }}
    >
      <header
        style={{
          padding: "16px 32px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            background: "var(--c-cornerstone)",
          }}
        />
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-plex-serif)",
            fontSize: 15,
            fontWeight: 400,
            color: "var(--ink)",
          }}
        >
          {threadTitle ?? "New conversation"}
        </h2>
      </header>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 32px",
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((m) => <Message key={m.id} message={m} />)
          )}
        </div>
      </div>

      <div style={{ padding: "0 32px", maxWidth: 760, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <Composer onSend={onSend} disabled={streaming} />
      </div>
    </section>
  );
}

function EmptyState() {
  const prompts = [
    "What do we know about Unilever's Q3 brief?",
    "Summarise the last client meeting notes.",
    "Find all facts tagged with #measurement.",
  ];
  return (
    <div
      style={{
        padding: "80px 0 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 28,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: "1px solid var(--c-cornerstone)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--c-cornerstone)",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
        }}
      >
        C·S
      </div>
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-plex-serif)",
            fontSize: 32,
            fontWeight: 400,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
            lineHeight: 1.15,
          }}
        >
          Ask Cornerstone.
        </h1>
        <p
          style={{
            margin: "10px 0 0",
            fontFamily: "var(--font-plex-sans)",
            fontSize: 14,
            color: "var(--ink-dim)",
            maxWidth: 520,
            lineHeight: 1.55,
          }}
        >
          Your long-term memory for Charlie Oscar. Facts, notes, conversations — all grounded in what the team has actually said and done.
        </p>
      </div>
      <div
        style={{
          width: "100%",
          borderTop: "1px solid var(--rule)",
          paddingTop: 20,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            marginBottom: 12,
          }}
        >
          Try
        </div>
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {prompts.map((p) => (
            <li
              key={p}
              style={{
                fontFamily: "var(--font-plex-sans)",
                fontSize: 13,
                color: "var(--ink-dim)",
                borderLeft: "1px solid var(--rule-2)",
                paddingLeft: 12,
              }}
            >
              {p}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
