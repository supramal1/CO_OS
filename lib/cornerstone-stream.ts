export type AnswerEvent =
  | { type: "status"; message: string }
  | {
      type: "context";
      sources: Array<{
        key: string;
        source_type: string;
        preview: string;
        section?: string;
        score: number;
      }>;
      source_count: number;
      context_request_id: string;
    }
  | { type: "answer_delta"; text: string }
  | { type: "clarification"; question: string }
  | {
      type: "tool_call";
      tool: string;
      status: "running" | "complete" | "error";
      params: Record<string, unknown>;
      call_index: number;
      result_count?: number;
    }
  | {
      type: "interpretation";
      original: string;
      resolved: string;
      note: string;
    }
  | {
      type: "pack_created";
      pack_id: string;
      title: string;
      template_id: string;
    }
  | {
      type: "done";
      answer: string;
      answer_status: string;
      confidence: string;
      source_count: number;
    }
  | { type: "error"; message: string };

export async function* readNdjson(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AnswerEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines[lines.length - 1];
      for (const line of lines.slice(0, -1)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed) as AnswerEvent;
        } catch {
          // ignore malformed line
        }
      }

      if (done) {
        const tail = buffer.trim();
        if (tail) {
          try {
            yield JSON.parse(tail) as AnswerEvent;
          } catch {
            // ignore trailing partial
          }
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
