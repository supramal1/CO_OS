import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import { forgeNamespaceFromRequest } from "@/lib/forge-namespace";

export const dynamic = "force-dynamic";

type IncomingMessage = { role: "user" | "assistant"; content: string };

type IntakeBody = {
  message: string;
  namespace?: string | null;
  threadId?: string | null;
  history?: IncomingMessage[];
};

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

const SYSTEM_PROMPT = [
  "You are Charlie, the Forge intake partner for the Charlie Oscar agency.",
  "Your job is to turn a casual problem description into a structured brief",
  "that the Forge team can triage. Be warm, concise, and specific.",
  "",
  "Flow:",
  "  1. When the user describes a problem, first call `search_existing_briefs`",
  "     to see if it has already been raised. If a close match exists, surface",
  "     it and ask whether this is the same issue.",
  "  2. Gather these fields conversationally (ask 1-2 questions per turn):",
  "     - title (short label)",
  "     - problem_statement (what's actually going wrong)",
  "     - frequency (daily / weekly / monthly / quarterly / one-off)",
  "     - time_cost_minutes (how long per occurrence)",
  "     - affected_scope (individual / team / agency / client)",
  "     - desired_outcome (what would 'fixed' look like)",
  "     - urgency (low / medium / high / critical)",
  "  3. When you have enough to be useful, summarise the brief back to the user",
  "     and confirm. On confirmation, call `submit_brief` with the fields.",
  "  4. After submission, reply with the returned brief id and a brief thank-you.",
  "",
  "Don't invent fields the user hasn't confirmed. If a field is genuinely",
  "unknown, leave it null in the submission.",
].join("\n");

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_existing_briefs",
    description:
      "Search the Forge briefs table for briefs whose title or problem statement match the query. Use this before gathering fields to avoid duplicates.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Short phrase describing the user's problem.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "submit_brief",
    description:
      "Create a new forge brief once the user has confirmed the details. Only call after an explicit yes from the user.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        problem_statement: { type: "string" },
        frequency: {
          type: "string",
          enum: ["daily", "weekly", "monthly", "quarterly", "one-off"],
          nullable: true,
        },
        time_cost_minutes: { type: "integer", minimum: 0, nullable: true },
        affected_scope: {
          type: "string",
          enum: ["individual", "team", "agency", "client"],
          nullable: true,
        },
        desired_outcome: { type: "string", nullable: true },
        urgency: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          nullable: true,
        },
      },
      required: ["title", "problem_statement"],
    },
  },
];

function write(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  event: Record<string, unknown>,
) {
  return writer.write(encoder.encode(JSON.stringify(event) + "\n"));
}

async function callSearchBriefs(
  apiKey: string,
  namespace: string,
  query: string,
): Promise<{ matches: unknown[]; error?: string }> {
  const url = new URL(`${CORNERSTONE_URL}/forge/briefs`);
  url.searchParams.set("namespace", namespace);
  url.searchParams.set("limit", "10");
  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) {
    return { matches: [], error: `search failed (${res.status})` };
  }
  const rows = (await res.json()) as Array<{
    id: string;
    title: string;
    problem_statement: string;
    status: string;
  }>;
  const needle = query.toLowerCase();
  const matches = rows
    .filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        r.problem_statement.toLowerCase().includes(needle),
    )
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      title: r.title,
      problem_statement: r.problem_statement.slice(0, 240),
      status: r.status,
    }));
  return { matches };
}

async function callSubmitBrief(
  apiKey: string,
  namespace: string,
  input: Record<string, unknown>,
): Promise<{ id?: string; error?: string }> {
  const url = new URL(`${CORNERSTONE_URL}/forge/briefs`);
  url.searchParams.set("namespace", namespace);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `submit failed (${res.status}): ${body.slice(0, 200)}` };
  }
  const row = (await res.json()) as { id: string };
  return { id: row.id };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const apiKey = session.apiKey;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json(
      { error: "anthropic_key_missing" },
      { status: 500 },
    );
  }

  const bodyText = await req.text();
  const namespace = forgeNamespaceFromRequest(req, bodyText);
  let body: IntakeBody;
  try {
    body = JSON.parse(bodyText || "{}") as IntakeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.message?.trim()) {
    return NextResponse.json({ error: "missing_message" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const history = body.history ?? [];
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: body.message },
  ];

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    try {
      let finalAnswer = "";
      for (let turn = 0; turn < 6; turn += 1) {
        const response = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        });

        const textBlocks = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (textBlocks) {
          await write(writer, encoder, {
            type: "answer_delta",
            text: textBlocks,
          });
          finalAnswer += textBlocks;
        }

        if (response.stop_reason !== "tool_use") {
          break;
        }

        const toolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );
        if (toolUses.length === 0) break;

        messages.push({ role: "assistant", content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const use of toolUses) {
          await write(writer, encoder, {
            type: "tool_call",
            tool: use.name,
            status: "running",
            params: use.input as Record<string, unknown>,
            call_index: toolResults.length,
          });

          let payload: Record<string, unknown>;
          if (use.name === "search_existing_briefs") {
            const input = use.input as { query: string };
            payload = await callSearchBriefs(apiKey, namespace, input.query ?? "");
          } else if (use.name === "submit_brief") {
            payload = await callSubmitBrief(
              apiKey,
              namespace,
              use.input as Record<string, unknown>,
            );
            if (payload.id) {
              await write(writer, encoder, {
                type: "brief_created",
                brief_id: payload.id,
              });
            }
          } else {
            payload = { error: `unknown tool: ${use.name}` };
          }

          await write(writer, encoder, {
            type: "tool_call",
            tool: use.name,
            status: payload.error ? "error" : "complete",
            params: use.input as Record<string, unknown>,
            call_index: toolResults.length,
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify(payload),
            is_error: Boolean(payload.error),
          });
        }

        messages.push({ role: "user", content: toolResults });
      }

      await write(writer, encoder, { type: "done", answer: finalAnswer });
    } catch (err) {
      const message = err instanceof Error ? err.message : "intake failure";
      console.error("forge_intake_chat_error", message);
      await write(writer, encoder, { type: "error", message });
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
