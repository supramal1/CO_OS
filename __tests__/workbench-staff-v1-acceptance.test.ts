import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

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

vi.mock("@/lib/workbench/retrieval", () => ({
  gatherWorkbenchRetrieval: (...args: unknown[]) =>
    mocks.gatherWorkbenchRetrieval(...args),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = {
      create: (...args: unknown[]) => mocks.anthropicCreate(...args),
    };
  },
}));

import { POST as startWorkbench } from "@/app/api/workbench/start/route";
import { POST as presendWorkbench } from "@/app/api/workbench/presend/route";
import { NAV_ITEMS } from "@/lib/modules";
import {
  WORKBENCH_GOOGLE_CONNECTOR_SCOPES,
  assessWorkbenchGoogleAuthReadiness,
} from "@/lib/workbench/google-auth";

function req(jsonBody: unknown): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}

const preflightResult = {
  decoded_task: {
    summary: "Prepare a client-ready follow-up note",
    requester: "Ops",
    deliverable_type: "written_response",
    task_type: "draft_check",
  },
  missing_context: [],
  drafted_clarifying_message: "",
  retrieved_context: [
    {
      claim: "Notion: client prefers concise next steps.",
      source_type: "notion",
      source_label: "Notion: Voice",
      source_url: "https://notion.test/voice",
    },
  ],
  suggested_approach: [],
  time_estimate: {
    estimated_before_minutes: 35,
    estimated_workbench_minutes: 12,
    task_type: "draft_check",
  },
  warnings: [],
};

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getSkill.mockReset();
  mocks.anthropicCreate.mockReset();
  mocks.gatherWorkbenchRetrieval.mockReset();
  mocks.persistWorkbenchInvocation.mockReset();
  process.env.ANTHROPIC_API_KEY = "anthropic-test";
  process.env.ANTHROPIC_MODEL = "claude-sonnet-test";
});

describe("Workbench staff-ready V1 acceptance", () => {
  it("reports authenticated config readiness with V1 connector scopes only", () => {
    const readiness = assessWorkbenchGoogleAuthReadiness({
      principalId: "principal_staff_1",
      config: {
        google_oauth_grant_status: "granted",
        google_oauth_scopes: [...WORKBENCH_GOOGLE_CONNECTOR_SCOPES],
      },
      storedTokenPresent: true,
    });

    expect(readiness).toMatchObject({
      ready: true,
      status: "ready",
      missing_scopes: [],
      blockers: [],
    });
    expect(readiness.required_scopes).toEqual([
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/calendar.readonly",
    ]);
    expect(readiness.required_scopes.join(" ")).not.toMatch(/gmail/i);
  });

  it("lets an authenticated staff user start preflight with partial retrieval", async () => {
    mocks.auth.mockResolvedValue({
      apiKey: "csk_staff",
      principalId: "principal_staff_1",
    });
    mocks.getSkill.mockResolvedValue({
      name: "workbench-preflight",
      version: "0.1.0",
      content: "PRE-FLIGHT SYSTEM PROMPT",
    });
    mocks.gatherWorkbenchRetrieval.mockResolvedValue({
      context: [
        {
          claim: "Notion profile says the client wants source-traced bullets.",
          source_type: "notion",
          source_label: "Notion: Personal Profile",
          source_url: "https://notion.test/profile",
        },
      ],
      statuses: [
        { source: "cornerstone", status: "ok", items_count: 0 },
        { source: "notion", status: "ok", items_count: 1 },
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
          items: [],
          warnings: [],
        },
        {
          source: "notion",
          status: "available",
          items: [
            {
              claim:
                "Notion profile says the client wants source-traced bullets.",
              source_type: "notion",
              source_label: "Notion: Personal Profile",
              source_url: "https://notion.test/profile",
            },
          ],
          warnings: [],
        },
        {
          source: "calendar",
          status: "unavailable",
          items: [],
          warnings: ["google_calendar_access_token_missing"],
        },
      ],
      warnings: ["google_calendar_access_token_missing"],
      generated_at: "2026-04-29T12:00:00.000Z",
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            decoded_task: {
              summary: "Prepare the staff response",
              requester: "Ops",
              deliverable_type: "written_response",
              task_type: "ask_decode",
            },
            missing_context: [],
            drafted_clarifying_message: "",
            retrieved_context: [
              {
                claim:
                  "Notion profile says the client wants source-traced bullets.",
                source_type: "notion",
                source_label: "Notion: Personal Profile",
                source_url: "https://notion.test/profile",
              },
            ],
            suggested_approach: [
              {
                step: "Proceed with available Notion context.",
                rationale: "Unavailable calendar is represented as a blocker.",
              },
            ],
            time_estimate: {
              estimated_before_minutes: 45,
              estimated_workbench_minutes: 15,
              task_type: "ask_decode",
            },
            warnings: ["Calendar retrieval unavailable."],
          }),
        },
      ],
    });

    const res = await startWorkbench(
      req({ ask: "Prepare the staff response from available context" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retrieval.statuses).toContainEqual({
      source: "calendar",
      status: "unavailable",
      reason: "google_calendar_access_token_missing",
      items_count: 0,
    });
    expect(body.result.retrieved_context).toHaveLength(1);
    expect(mocks.gatherWorkbenchRetrieval).toHaveBeenCalledWith(
      expect.objectContaining({
        ask: "Prepare the staff response from available context",
        userId: "principal_staff_1",
        apiKey: "csk_staff",
      }),
    );
  });

  it("returns a clear staff-visible Anthropic auth error when the key is rejected", async () => {
    mocks.auth.mockResolvedValue({
      apiKey: "csk_staff",
      principalId: "principal_staff_1",
    });
    mocks.getSkill.mockResolvedValue({
      name: "workbench-preflight",
      version: "0.1.0",
      content: "PRE-FLIGHT SYSTEM PROMPT",
    });
    mocks.gatherWorkbenchRetrieval.mockResolvedValue({
      context: [],
      statuses: [
        { source: "cornerstone", status: "ok", items_count: 0 },
        { source: "notion", status: "ok", items_count: 0 },
      ],
      sources: [],
      warnings: [],
      generated_at: "2026-04-29T12:00:00.000Z",
    });
    const rejectedKey = new Error(
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    ) as Error & { status: number };
    rejectedKey.status = 401;
    mocks.anthropicCreate.mockRejectedValue(rejectedKey);

    const res = await startWorkbench(
      req({ ask: "Prepare the staff response from available context" }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "anthropic_api_key_rejected",
      detail:
        "Anthropic rejected ANTHROPIC_API_KEY. Update the local key and restart the dev server.",
    });
  });

  it("returns staff-visible save_back status from presend", async () => {
    mocks.auth.mockResolvedValue({
      apiKey: "csk_staff",
      principalId: "principal_staff_1",
    });
    mocks.getSkill.mockResolvedValue({
      name: "workbench-presend",
      version: "0.1.0",
      content: "PRESEND SYSTEM PROMPT",
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            artifact_intent: {
              artifact_type: "docx_scaffold",
              title: "Client follow-up",
              audience: "Client team",
              purpose: "Summarize decisions and next steps",
            },
            artifact_spec: {
              format: "docx",
              sections: [
                {
                  heading: "Next steps",
                  purpose: "Make ownership clear",
                },
              ],
              source_context: preflightResult.retrieved_context,
            },
            quality_checks: [
              {
                check: "Source-backed claims only",
                status: "pass",
                detail: null,
              },
            ],
            save_back_requirements: [
              {
                target: "drive",
                action: "create_docx",
                required: true,
                reason: "Save the staff-ready artifact to Drive.",
              },
            ],
            warnings: [],
          }),
        },
      ],
    });

    const res = await presendWorkbench(
      req({
        preflight_result: preflightResult,
        draft_input: "Summarize the decision and next steps.",
        artifact_spec_input: "Create a docx scaffold and save it back.",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.save_back).toMatchObject({
      status: "unavailable",
      target: "drive",
      reason: "user_workbench_config_missing",
    });
  });

  it("keeps Gmail out of Workbench-owned runtime code", () => {
    const matches = workbenchRuntimeFiles().flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [
        ...text.matchAll(
          /gmail|googleapis\.com\/auth\/gmail|gmail\.compose|drafts/gi,
        ),
      ].map((match) => `${relative(process.cwd(), file)}:${match[0]}`);
    });

    expect(matches).toEqual([]);
  });

  it("keeps Workbench top-level and outside the Dispatch nav group", () => {
    const dispatch = NAV_ITEMS.find(
      (item) => item.type === "group" && item.id === "dispatch",
    );
    const workbench = NAV_ITEMS.find(
      (item) => item.type === "group" && item.id === "work",
    );

    expect(dispatch).toMatchObject({
      type: "group",
      id: "dispatch",
      label: "Dispatch",
      children: expect.not.arrayContaining(["workbench"]),
    });
    expect(workbench).toMatchObject({
      type: "group",
      id: "work",
      label: "Workbench",
      children: ["workbench"],
    });
  });
});

function workbenchRuntimeFiles(): string[] {
  return ["lib/workbench", "app/api/workbench", "components/workbench"].flatMap(
    (dir) => listFiles(join(process.cwd(), dir)),
  );
}

function listFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path).flatMap((entry) => listFiles(join(path, entry)));
}
