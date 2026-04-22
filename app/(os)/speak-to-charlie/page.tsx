"use client";

import { ChatShell } from "@/components/cornerstone/chat-shell";

export default function SpeakToCharliePage() {
  return (
    <ChatShell
      endpoint="/api/forge/intake/chat"
      errorLabel="Couldn't reach Charlie"
      buildBody={({ text, threadId, history }) => ({
        message: text,
        threadId,
        history,
      })}
    />
  );
}
