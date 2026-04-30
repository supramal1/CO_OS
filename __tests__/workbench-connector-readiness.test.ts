import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { deriveWorkbenchUiSummary } from "@/components/workbench/workbench-shell";
import type { WorkbenchStartResponse } from "@/lib/workbench/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getSkill: vi.fn(),
  anthropicCreate: vi.fn(),
  gatherWorkbenchRetrieval: vi.fn(),
  persistWorkbenchInvocation: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/cookbook-client", () => ({
  getSkill: (...args: unknown[]) => mocks.getSkill(...args),
  CookbookMcpError: class CookbookMcpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/workbench/persistence", () => ({
  persistWorkbenchInvocation: (...args: unknown[]) =>
    mocks.persistWorkbenchInvocation(...args),
}));

vi.mock("@/lib/workbench/retrieval", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workbench/retrieval")>();
  return {
    ...actual,
    gatherWorkbenchRetrieval: (...args: unknown[]) =>
      mocks.gatherWorkbenchRetrieval(...args),
  };
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = {
      create: (...args: unknown[]) => mocks.anthropicCreate(...args),
    };
  },
}));

import { POST } from "@/app/api/workbench/start/route";

function req(jsonBody: unknown): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getSkill.mockReset();
  mocks.anthropicCreate.mockReset();
  mocks.gatherWorkbenchRetrieval.mockReset();
  mocks.persistWorkbenchInvocation.mockReset();
  process.env.ANTHROPIC_API_KEY = "anthropic-test";
  process.env.ANTHROPIC_MODEL = "claude-sonnet-test";
});

describe("Workbench connector readiness smoke", () => {
  it("runs preflight in degraded mode and surfaces connector blockers", async () => {
    mocks.auth.mockResolvedValue({
      apiKey: "csk_test",
      principalId: "principal_user_1",
    });
    mocks.getSkill.mockResolvedValue({
      name: "workbench-preflight",
      version: "0.1.0",
      content: "PRE-FLIGHT SYSTEM PROMPT",
    });
    mocks.gatherWorkbenchRetrieval.mockResolvedValue({
      context: [
        {
          claim: "Existing cornerstone context is available.",
          source_type: "cornerstone",
          source_label: "Memory: Workbench V1",
          source_url: null,
        },
      ],
      statuses: [
        { source: "cornerstone", status: "ok", items_count: 1 },
        {
          source: "notion",
          status: "unavailable",
          reason: "notion_parent_page_id_missing",
          items_count: 0,
        },
        {
          source: "calendar",
          status: "unavailable",
          reason: "google_calendar_access_token_missing",
          items_count: 0,
        },
      ],
      sources: [
        {
          source: "cornerstone",
          status: "available",
          items: [
            {
              claim: "Existing cornerstone context is available.",
              source_type: "cornerstone",
              source_label: "Memory: Workbench V1",
              source_url: null,
            },
          ],
          warnings: [],
        },
        {
          source: "notion",
          status: "unavailable",
          items: [],
          warnings: ["notion_parent_page_id_missing"],
        },
        {
          source: "calendar",
          status: "unavailable",
          items: [],
          warnings: ["google_calendar_access_token_missing"],
        },
      ],
      warnings: [
        "notion_parent_page_id_missing",
        "google_calendar_access_token_missing",
        "missing_drive_folder",
      ],
      generated_at: "2026-04-29T12:00:00.000Z",
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            decoded_task: {
              summary: "Prepare a connector readiness response",
              requester: "Ops",
              deliverable_type: "written_response",
              task_type: "ask_decode",
            },
            missing_context: [
              {
                question: "Should the artifact be saved back now?",
                why: "Drive save-back is unavailable without a folder.",
              },
            ],
            drafted_clarifying_message:
              "I can proceed with available context, but save-back is blocked.",
            retrieved_context: [
              {
                claim: "Existing cornerstone context is available.",
                source_type: "cornerstone",
                source_label: "Memory: Workbench V1",
                source_url: null,
              },
            ],
            suggested_approach: [
              {
                step: "Continue with degraded preflight output.",
                rationale: "Unavailable connectors are reported as blockers.",
              },
            ],
            time_estimate: {
              estimated_before_minutes: 45,
              estimated_workbench_minutes: 20,
              task_type: "ask_decode",
            },
            warnings: ["Connector readiness is degraded."],
          }),
        },
      ],
    });

    const res = await POST(req({ ask: "Check connector readiness for Workbench" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkbenchStartResponse;
    expect(body.retrieval.statuses).toEqual([
      { source: "cornerstone", status: "ok", items_count: 1 },
      {
        source: "notion",
        status: "unavailable",
        reason: "notion_parent_page_id_missing",
        items_count: 0,
      },
      {
        source: "calendar",
        status: "unavailable",
        reason: "google_calendar_access_token_missing",
        items_count: 0,
      },
    ]);
    expect(body.retrieval.warnings).toContain("missing_drive_folder");

    const summary = deriveWorkbenchUiSummary(body);
    expect(summary.retrievalRows).toEqual([
      {
        source: "cornerstone",
        label: "Cornerstone",
        status: "available",
        itemsCount: 1,
        reason: null,
        detail: "Connected",
        warnings: [],
      },
      {
        source: "notion",
        label: "Notion",
        status: "unavailable",
        itemsCount: 0,
        reason: "notion_parent_page_id_missing",
        detail: "Repair Workbench pages",
        warnings: ["Repair Workbench pages"],
      },
      {
        source: "calendar",
        label: "Calendar",
        status: "unavailable",
        itemsCount: 0,
        reason: "google_calendar_access_token_missing",
        detail: "Reconnect Google Workspace",
        warnings: ["Reconnect Google Workspace"],
      },
    ]);
    expect(summary.warningCount).toBe(4);
    expect(mocks.anthropicCreate.mock.calls[0][0].messages[0].content).toContain(
      "calendar: unavailable",
    );
  });

  it("reports live-ready retrieval when adapters are injected", async () => {
    const { gatherWorkbenchRetrieval } =
      await vi.importActual<typeof import("@/lib/workbench/retrieval")>(
        "@/lib/workbench/retrieval",
      );

    const retrieval = await gatherWorkbenchRetrieval({
      ask: "Prep Nike QBR response",
      userId: "principal_live_ready",
      apiKey: "csk_test",
      config: null,
      now: new Date("2026-04-29T12:00:00.000Z"),
      adapters: {
        cornerstone: async () => ({
          source: "cornerstone",
          status: "available",
          items: [
            {
              claim: "QBR preference: lead with decisions.",
              source_type: "cornerstone",
              source_label: "Memory: Nike QBR",
              source_url: null,
            },
          ],
          warnings: [],
        }),
        notion: async () => ({
          source: "notion",
          status: "available",
          items: [
            {
              claim: "Notion has the latest QBR outline.",
              source_type: "notion",
              source_label: "Nike QBR outline",
              source_url: "https://notion.test/nike-qbr",
            },
          ],
          warnings: [],
        }),
        calendar: async () => ({
          source: "calendar",
          status: "available",
          items: [
            {
              claim: "Calendar event: Nike QBR prep, 2026-05-02T10:00:00.000Z",
              source_type: "calendar",
              source_label: "Nike QBR prep",
              source_url: "https://calendar.google.com/event?eid=event-1",
            },
          ],
          warnings: [],
        }),
      },
    });

    expect(retrieval.context).toHaveLength(3);
    expect(retrieval.statuses).toEqual([
      { source: "cornerstone", status: "ok", reason: undefined, items_count: 1 },
      { source: "notion", status: "ok", reason: undefined, items_count: 1 },
      { source: "calendar", status: "ok", reason: undefined, items_count: 1 },
    ]);
    expect(retrieval.sources.map((source) => source.status)).toEqual([
      "available",
      "available",
      "available",
    ]);
    expect(retrieval.warnings).toEqual([]);
  });
});
