// Stashed 2026-04-22. Cornerstone accessed via Cowork MCP.
// Route retained for potential client-facing use. See
// co_os_navigation_structure fact in Cornerstone. The
// underscore-prefixed parent directory (_stashed) is excluded
// from Next.js routing, so this file no longer renders.
import { ChatShell } from "@/components/cornerstone/chat-shell";

export default function CornerstonePage() {
  return <ChatShell />;
}
