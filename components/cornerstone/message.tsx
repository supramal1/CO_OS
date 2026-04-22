"use client";

export type Role = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  streaming?: boolean;
};

export function Message({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      style={{
        display: "flex",
        gap: 18,
        padding: "18px 0",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 64,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: isUser ? "var(--ink-dim)" : "var(--c-cornerstone)",
          paddingTop: 2,
        }}
      >
        {isUser ? "You" : "C·S"}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--ink)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message.content}
        {message.streaming && (
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 14,
              marginLeft: 2,
              background: "var(--c-cornerstone)",
              verticalAlign: "text-bottom",
              animation: "co-blink 1s steps(2) infinite",
            }}
          />
        )}
      </div>
    </div>
  );
}
