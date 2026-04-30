import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  tokenGet: vi.fn(),
  createWorkbenchNotionClient: vi.fn(),
  ensureWorkbenchNotionSetup: vi.fn(),
  getUserWorkbenchConfig: vi.fn(),
  patchWorkbenchUserConfig: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

vi.mock("@/lib/workbench/notion-token-store", () => ({
  createWorkbenchNotionTokenStore: () => ({
    get: (...args: unknown[]) => mocks.tokenGet(...args),
  }),
}));

vi.mock("@/lib/workbench/notion-client", () => ({
  createWorkbenchNotionClient: (...args: unknown[]) =>
    mocks.createWorkbenchNotionClient(...args),
}));

vi.mock("@/lib/workbench/notion-setup", () => ({
  ensureWorkbenchNotionSetup: (...args: unknown[]) =>
    mocks.ensureWorkbenchNotionSetup(...args),
}));

vi.mock("@/lib/workbench/retrieval/config", () => ({
  getUserWorkbenchConfig: (...args: unknown[]) =>
    mocks.getUserWorkbenchConfig(...args),
}));

vi.mock("@/lib/workbench/user-config", () => ({
  patchWorkbenchUserConfig: (...args: unknown[]) =>
    mocks.patchWorkbenchUserConfig(...args),
}));

import { POST } from "@/app/api/workbench/onboarding/route";
import { runWorkbenchOnboardingAction } from "@/lib/workbench/onboarding-action";
import {
  generateWorkbenchOnboardingDraft,
  normalizeWorkbenchOnboardingPayload,
  saveWorkbenchOnboarding,
  type WorkbenchOnboardingDraft,
  type WorkbenchOnboardingModelClient,
} from "@/lib/workbench/personalisation";

function request(jsonBody: unknown): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}

function validPayload() {
  return {
    role: " Senior Strategist ",
    team: " Client Strategy ",
    tenure: " 1-3 years ",
    current_work_bullets: [
      "Nike QBR narrative",
      "AI adoption plan",
      "Weekly client status",
      "Deck quality bar",
      "New starter support",
      "Extra item that should be trimmed",
    ],
    friction_chips: ["deck building", "status updates", "deck building"],
    friction_other: " stakeholder alignment ",
    feedback_style: "show me what would strengthen this",
    output_preference: "concise, direct, with next steps",
    personal_context_bullets: [
      "Prefers direct language",
      "Uses bullets for quick scanning",
    ],
  };
}

function validDraft(): WorkbenchOnboardingDraft {
  return {
    personal_profile: {
      bullets: [
        "Senior Strategist in Client Strategy.",
        "Prefers direct language and scannable bullets.",
      ],
    },
    working_on: {
      bullets: ["Nike QBR narrative.", "AI adoption plan."],
    },
    voice: {
      bullets: [
        "Use concise outputs with clear next steps.",
        "Feedback should show what would strengthen the work.",
      ],
    },
  };
}

describe("Workbench onboarding personalisation", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.tokenGet.mockReset();
    mocks.createWorkbenchNotionClient.mockReset();
    mocks.ensureWorkbenchNotionSetup.mockReset();
    mocks.getUserWorkbenchConfig.mockReset();
    mocks.patchWorkbenchUserConfig.mockReset();
  });

  it("normalizes the five-minute onboarding payload into concise staff signals", () => {
    const result = normalizeWorkbenchOnboardingPayload(validPayload());

    expect(result).toEqual({
      ok: true,
      payload: {
        role: "Senior Strategist",
        team: "Client Strategy",
        tenure: "1-3 years",
        current_work: [
          "Nike QBR narrative",
          "AI adoption plan",
          "Weekly client status",
          "Deck quality bar",
          "New starter support",
        ],
        friction_tasks: [
          "deck building",
          "status updates",
          "stakeholder alignment",
        ],
        feedback_style: "show me what would strengthen this",
        output_preference: "concise, direct, with next steps",
        personal_context: [
          "Prefers direct language",
          "Uses bullets for quick scanning",
        ],
      },
    });
  });

  it("returns field-level validation errors when required onboarding signals are missing", () => {
    const result = normalizeWorkbenchOnboardingPayload({
      role: "",
      team: "",
      tenure: "",
      current_work_bullets: [],
      friction_chips: [],
      friction_other: " ",
      feedback_style: "",
      output_preference: "",
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_workbench_onboarding_payload",
      fields: [
        "role",
        "team",
        "tenure",
        "current_work_bullets",
        "friction_tasks",
        "feedback_style",
        "output_preference",
      ],
    });
  });

  it("generates an AI draft through an injected model client and strict JSON response", async () => {
    const modelClient: WorkbenchOnboardingModelClient = {
      create: vi.fn(async () => JSON.stringify(validDraft())),
    };

    const result = await generateWorkbenchOnboardingDraft({
      payload: validPayload(),
      modelClient,
    });

    expect(result).toEqual({
      status: "drafted",
      draft: validDraft(),
    });
    expect(modelClient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 900,
        temperature: 0.2,
        system: expect.stringContaining("Return only strict JSON"),
        prompt: expect.stringContaining("Senior Strategist"),
      }),
    );
  });

  it("rejects model responses that do not match the strict onboarding draft JSON", async () => {
    const modelClient: WorkbenchOnboardingModelClient = {
      create: vi.fn(async () =>
        JSON.stringify({
          personal_profile: { bullets: ["Valid profile"] },
          working_on: { bullets: ["Valid work"] },
        }),
      ),
    };

    const result = await generateWorkbenchOnboardingDraft({
      payload: validPayload(),
      modelClient,
    });

    expect(result).toEqual({
      status: "error",
      error: "onboarding_draft_invalid_json",
      message:
        "Workbench could not turn that into a profile preview. Please try again.",
    });
  });

  it("saves approved onboarding content through setup, writer, and config boundaries", async () => {
    const setup = vi.fn(async () => ({
      status: "validated" as const,
      parent_id: "parent-page",
      child_ids: {
        "Personal Profile": "profile-page",
        "Working On": "working-page",
        Patterns: "patterns-page",
        References: "references-page",
        Voice: "voice-page",
      },
      counts: { created: 0, validated: 6, repaired: 0 },
    }));
    const writer = {
      appendManagedSection: vi.fn(async (input: { pageTitle: string }) => ({
        status: "updated" as const,
        page_title: input.pageTitle,
      })),
    };
    const configStore = {
      save: vi.fn(async () => ({ status: "stored" as const })),
    };

    const result = await saveWorkbenchOnboarding({
      userId: "principal_123",
      payload: validPayload(),
      draft: validDraft(),
      setup,
      writer,
      configStore,
    });

    expect(result).toEqual({
      status: "profile_updated",
      message: "Your Workbench profile is set up.",
      pages: ["Personal Profile", "Working On", "Voice"],
      config: { status: "stored" },
    });
    expect(setup).toHaveBeenCalledWith({ userId: "principal_123" });
    expect(writer.appendManagedSection.mock.calls.map((call) => call[0])).toEqual([
      {
        userId: "principal_123",
        pageId: "profile-page",
        pageTitle: "Personal Profile",
        heading: "Workbench onboarding",
        bullets: validDraft().personal_profile.bullets,
        source: "onboarding",
      },
      {
        userId: "principal_123",
        pageId: "working-page",
        pageTitle: "Working On",
        heading: "Workbench onboarding",
        bullets: validDraft().working_on.bullets,
        source: "onboarding",
      },
      {
        userId: "principal_123",
        pageId: "voice-page",
        pageTitle: "Voice",
        heading: "Workbench onboarding",
        bullets: validDraft().voice.bullets,
        source: "onboarding",
      },
    ]);
    expect(configStore.save).toHaveBeenCalledWith({
      userId: "principal_123",
      feedback_style: "show me what would strengthen this",
      voice_register: "concise, direct, with next steps",
      friction_tasks: [
        "deck building",
        "status updates",
        "stakeholder alignment",
      ],
    });
    expect(JSON.stringify(result)).not.toContain("profile-page");
  });

  it("returns a friendly setup status when Notion setup is not ready", async () => {
    const result = await saveWorkbenchOnboarding({
      userId: "principal_123",
      payload: validPayload(),
      draft: validDraft(),
      setup: vi.fn(async () => ({
        status: "failed" as const,
        parent_id: null,
        child_ids: {},
        counts: { created: 0, validated: 0, repaired: 0 },
        reason: "notion_reauth_required",
      })),
      writer: {
        appendManagedSection: vi.fn(),
      },
    });

    expect(result).toEqual({
      status: "setup_needed",
      message: "Connect Notion to finish setting up your Workbench profile.",
    });
  });

  it("runs the onboarding draft action through the API action helper", async () => {
    const modelClient: WorkbenchOnboardingModelClient = {
      create: vi.fn(async () => JSON.stringify(validDraft())),
    };

    const result = await runWorkbenchOnboardingAction({
      userId: "principal_123",
      body: { action: "draft", payload: validPayload() },
      dependencies: { modelClient },
    });

    expect(result).toEqual({
      status: 200,
      body: {
        status: "drafted",
        draft: validDraft(),
      },
    });
  });

  it("runs the onboarding save action through stored Notion and config wiring", async () => {
    const appendBlockChildren = vi.fn(async (pageId: string) => {
      expect(pageId).toBeTruthy();
      return [];
    });
    mocks.tokenGet.mockResolvedValue({ accessToken: "notion-oauth-token" });
    mocks.getUserWorkbenchConfig.mockResolvedValue({
      user_id: "principal_123",
      notion_parent_page_id: "parent-page",
    });
    mocks.ensureWorkbenchNotionSetup.mockResolvedValue({
      status: "validated",
      parent_id: "parent-page",
      child_ids: {
        "Personal Profile": "profile-page",
        "Working On": "working-page",
        Patterns: "patterns-page",
        References: "references-page",
        Voice: "voice-page",
      },
      counts: { created: 0, validated: 6, repaired: 0 },
    });
    mocks.createWorkbenchNotionClient.mockReturnValue({
      client: { appendBlockChildren },
      status: { source: "notion", status: "ok", items_count: 0 },
    });
    mocks.patchWorkbenchUserConfig.mockResolvedValue({
      status: "ok",
      config: null,
      google_readiness: null,
    });

    const result = await runWorkbenchOnboardingAction({
      userId: "principal_123",
      body: { action: "save", payload: validPayload(), draft: validDraft() },
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: "profile_updated",
      pages: ["Personal Profile", "Working On", "Voice"],
      config: { status: "stored" },
    });
    expect(mocks.tokenGet).toHaveBeenCalledWith("principal_123");
    expect(mocks.ensureWorkbenchNotionSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "principal_123",
        config: expect.objectContaining({ notion_parent_page_id: "parent-page" }),
        token: "notion-oauth-token",
      }),
    );
    expect(mocks.createWorkbenchNotionClient).toHaveBeenCalledWith({
      token: "notion-oauth-token",
    });
    expect(appendBlockChildren.mock.calls.map((call) => call[0])).toEqual([
      "profile-page",
      "working-page",
      "voice-page",
    ]);
    expect(mocks.patchWorkbenchUserConfig).toHaveBeenCalledWith(
      "principal_123",
      {
        feedback_style: "show me what would strengthen this",
        voice_register: "concise, direct, with next steps",
        friction_tasks: [
          "deck building",
          "status updates",
          "stakeholder alignment",
        ],
      },
    );
  });

  it("rejects unauthenticated onboarding route requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await POST(request({ action: "draft", payload: validPayload() }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });
});
