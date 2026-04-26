import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
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
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey || !session.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const detail = getTaskDetail(params.id, session.principalId);
  if (!detail) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const taskId = params.id;
  const seenSeqs = new Set<number>();
  const encoder = new TextEncoder();

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

      // Replay cached events for late subscribers.
      for (const entry of getCachedEvents(taskId)) {
        seenSeqs.add(entry.seq);
        send("event", entry);
      }

      // If already terminal, send an end frame and close.
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
          unsubscribe();
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

      const cleanup = () => {
        clearInterval(hb);
        unsubscribe();
      };
      // @ts-expect-error attach cleanup so cancel() can find it
      controller._cleanup = cleanup;
    },
    cancel(controller) {
      // @ts-expect-error read attached cleanup
      controller._cleanup?.();
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
