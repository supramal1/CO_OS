import { CORNERSTONE_URL } from "@/lib/cornerstone";
import type { WorkbenchRetrievedContext } from "../types";
import {
  errorStatus,
  okStatus,
  unavailableStatus,
  type WorkbenchRetrievalAdapterResult,
} from "./types";

export type RetrieveCornerstoneContextInput = {
  ask: string;
  apiKey: string | null;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export async function retrieveCornerstoneContext(
  input: RetrieveCornerstoneContextInput,
): Promise<WorkbenchRetrievalAdapterResult> {
  if (!input.apiKey) {
    return {
      items: [],
      status: unavailableStatus("cornerstone", "Missing Cornerstone API key."),
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = input.baseUrl ?? CORNERSTONE_URL;
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": input.apiKey,
      },
      body: JSON.stringify({
        query: input.ask,
        namespace: "default",
        detail_level: "minimal",
        max_tokens: 600,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        items: [],
        status: errorStatus("cornerstone", `Cornerstone returned ${res.status}.`),
      };
    }
    const body = (await res.json().catch(() => null)) as unknown;
    const context = contextText(body);
    if (!context) return { items: [], status: okStatus("cornerstone", 0) };
    const items: WorkbenchRetrievedContext[] = [
      {
        claim: context,
        source_type: "cornerstone",
        source_label: sourceLabel(body),
        source_url: null,
      },
    ];
    return { items, status: okStatus("cornerstone", items.length) };
  } catch (err) {
    return {
      items: [],
      status: errorStatus(
        "cornerstone",
        err instanceof Error ? err.message : String(err),
      ),
    };
  }
}

function contextText(body: unknown): string {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  const candidates = [
    record.context,
    record.result,
    record.answer,
    record.content,
    record.text,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return "";
}

function sourceLabel(body: unknown): string {
  if (body && typeof body === "object") {
    const requestId = (body as Record<string, unknown>).context_request_id;
    if (typeof requestId === "string" && requestId.trim()) {
      return `Cornerstone context ${requestId}`;
    }
  }
  return "Cornerstone default context";
}
