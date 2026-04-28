import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  getCachedEvents,
  getTaskDetail,
  isTerminal,
} from "@/lib/workforce/runner";
import { subscribe } from "@/lib/workforce/bus";

export const dynamic = "force-dynamic";

// Server-Sent Events stream for a single task. Replays cached events first
// (so reconnects don't miss anything emitted before subscription) and then
// forwards live events from the in-process bus until the task terminates.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.apiKey || !session.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const { id: taskId } = await params;
  const detail = await getTaskDetail(taskId, session.principalId);
  if (!detail) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const seenSeqs = new Set<number>();
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (eventName: string, data: unknown) => {
        const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // controller closed
        }
      };

      for (const entry of getCachedEvents(taskId)) {
        seenSeqs.add(entry.seq);
        send("event", entry);
      }

      if (isTerminal(taskId)) {
        send("end", { state: detail.state });
        controller.close();
        return;
      }

      const unsubscribe = subscribe(taskId, (msg) => {
        if (msg.kind === "event") {
          if (seenSeqs.has(msg.entry.seq)) return;
          seenSeqs.add(msg.entry.seq);
          send("event", msg.entry);
        } else if (msg.kind === "end") {
          send("end", { state: msg.state });
          if (cleanup) cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      });

      // Heartbeat every 15s — keeps proxies (Vercel, Cloud Run) from
      // closing the connection mid-task.
      const hb = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(hb);
          unsubscribe();
        }
      }, 15_000);

      cleanup = () => {
        clearInterval(hb);
        unsubscribe();
      };
    },
    cancel() {
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
