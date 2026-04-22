"use client";

import { useState } from "react";
import { ThreadList, type Thread } from "./thread-list";
import { Conversation } from "./conversation";
import type { ChatMessage } from "./message";
import { readNdjson } from "@/lib/cornerstone-stream";

export type ChatShellProps = {
  endpoint?: string;
  errorLabel?: string;
  buildBody?: (args: {
    text: string;
    threadId: string;
    history: { role: "user" | "assistant"; content: string }[];
  }) => Record<string, unknown>;
};

export function ChatShell({
  endpoint = "/api/cornerstone/query",
  errorLabel = "Couldn't reach Cornerstone",
  buildBody,
}: ChatShellProps = {}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messagesByThread, setMessagesByThread] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [streaming, setStreaming] = useState(false);

  const activeThread = threads.find((t) => t.id === activeId) ?? null;
  const messages = activeId ? messagesByThread[activeId] ?? [] : [];

  const handleNew = () => setActiveId(null);

  const handleSend = async (text: string) => {
    let threadId = activeId;
    const isNewThread = !threadId;
    if (!threadId) {
      threadId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `t-${Date.now()}`;
      const newThread: Thread = {
        id: threadId,
        title: text.slice(0, 48),
        updatedAt: new Date().toISOString(),
      };
      setThreads((ts) => [newThread, ...ts]);
      setActiveId(threadId);
    }
    const tid = threadId!;

    const userMsg: ChatMessage = {
      id: `m-${Date.now()}-u`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    const history = (messagesByThread[tid] ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessagesByThread((m) => ({
      ...m,
      [tid]: [...(m[tid] ?? []), userMsg],
    }));
    if (!isNewThread) {
      setThreads((ts) =>
        ts.map((t) =>
          t.id === tid ? { ...t, updatedAt: new Date().toISOString() } : t,
        ),
      );
    }

    const assistantId = `m-${Date.now()}-a`;
    setMessagesByThread((m) => ({
      ...m,
      [tid]: [
        ...(m[tid] ?? []),
        {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          streaming: true,
        },
      ],
    }));
    setStreaming(true);

    const appendAssistant = (chunk: string) => {
      setMessagesByThread((m) => {
        const msgs = m[tid] ?? [];
        return {
          ...m,
          [tid]: msgs.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: msg.content + chunk }
              : msg,
          ),
        };
      });
    };

    const finalizeAssistant = (overrideContent?: string) => {
      setMessagesByThread((m) => {
        const msgs = m[tid] ?? [];
        return {
          ...m,
          [tid]: msgs.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  streaming: false,
                  content:
                    overrideContent !== undefined && msg.content === ""
                      ? overrideContent
                      : msg.content,
                }
              : msg,
          ),
        };
      });
    };

    try {
      const requestBody = buildBody
        ? buildBody({ text, threadId: tid, history })
        : { query: text, threadId: tid, history };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body?.error ?? `status ${res.status}`);
      }

      let fallbackAnswer = "";
      let errored = false;

      for await (const event of readNdjson(res.body)) {
        switch (event.type) {
          case "answer_delta":
            appendAssistant(event.text);
            break;
          case "done":
            fallbackAnswer = event.answer ?? "";
            break;
          case "error":
            errored = true;
            appendAssistant(
              `\n\n_Error — ${event.message || "upstream failure"}_`,
            );
            break;
          case "clarification":
            appendAssistant(event.question);
            break;
          default:
            break;
        }
      }

      finalizeAssistant(errored ? undefined : fallbackAnswer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "request failed";
      setMessagesByThread((m) => {
        const msgs = m[tid] ?? [];
        return {
          ...m,
          [tid]: msgs.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  streaming: false,
                  content: `${errorLabel} — ${message}`,
                }
              : msg,
          ),
        };
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "grid",
        gridTemplateColumns: "260px minmax(0, 1fr)",
        minHeight: 0,
      }}
    >
      <ThreadList
        threads={threads}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={handleNew}
      />
      <Conversation
        messages={messages}
        onSend={handleSend}
        streaming={streaming}
        threadTitle={activeThread?.title ?? null}
      />
    </div>
  );
}
