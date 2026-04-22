"use client";

import { useRef, useState, useEffect } from "react";

export function Composer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  const submit = () => {
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setValue("");
  };

  return (
    <div
      style={{
        borderTop: "1px solid var(--rule)",
        background: "var(--bg)",
        padding: "14px 0 18px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 12,
          border: "1px solid var(--rule-2)",
          background: "var(--panel)",
          padding: "10px 12px",
        }}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Describe the problem…"
          rows={1}
          disabled={disabled}
          style={{
            flex: 1,
            resize: "none",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--ink)",
            fontFamily: "var(--font-plex-sans)",
            fontSize: 14,
            lineHeight: 1.55,
            minHeight: 22,
            maxHeight: 200,
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          style={{
            alignSelf: "stretch",
            padding: "0 14px",
            border: `1px solid ${value.trim() && !disabled ? "var(--c-forge)" : "var(--rule-2)"}`,
            background: "transparent",
            color: value.trim() && !disabled ? "var(--c-forge)" : "var(--ink-faint)",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: value.trim() && !disabled ? "pointer" : "not-allowed",
            transition: "color 120ms ease, border-color 120ms ease",
          }}
        >
          Send
        </button>
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          color: "var(--ink-faint)",
          letterSpacing: "0.06em",
        }}
      >
        Enter to send · Shift+Enter for newline
      </div>
    </div>
  );
}
