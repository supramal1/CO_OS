import Anthropic from "@anthropic-ai/sdk";
import type {
  WorkbenchNotionSetupChildTitle,
  WorkbenchNotionSetupReport,
} from "./notion-setup";

const MAX_ONBOARDING_BULLETS = 5;
const MAX_DRAFT_BULLETS = 5;
const MAX_DRAFT_BULLET_CHARS = 180;

export type WorkbenchOnboardingPayloadInput = {
  role_title?: unknown;
  current_focus_bullets?: unknown;
  work_type_chips?: unknown;
  work_type_other?: unknown;
  communication_style?: unknown;
  challenge_style?: unknown;
  helpful_context?: unknown;
  helpful_context_other?: unknown;
  role?: unknown;
  team?: unknown;
  current_work_bullets?: unknown;
  friction_chips?: unknown;
  friction_other?: unknown;
  feedback_style?: unknown;
  output_preference?: unknown;
  personal_context_bullets?: unknown;
};

export type WorkbenchOnboardingPayload = {
  role_title: string;
  current_focus: string[];
  work_types: string[];
  communication_style: string[];
  challenge_style: string[];
  helpful_context: string[];
};

export type WorkbenchOnboardingPayloadValidation =
  | { ok: true; payload: WorkbenchOnboardingPayload }
  | {
      ok: false;
      error: "invalid_workbench_onboarding_payload";
      fields: string[];
    };

export type WorkbenchOnboardingPreviewBlock = {
  bullets: string[];
};

export type WorkbenchOnboardingDraft = {
  personal_profile: WorkbenchOnboardingPreviewBlock;
  working_on: WorkbenchOnboardingPreviewBlock;
  voice: WorkbenchOnboardingPreviewBlock;
};

export type WorkbenchOnboardingModelClient = {
  create(input: {
    system: string;
    prompt: string;
    temperature: number;
    maxTokens: number;
  }): Promise<string>;
};

export type WorkbenchOnboardingDraftResult =
  | { status: "drafted"; draft: WorkbenchOnboardingDraft }
  | {
      status: "invalid_payload";
      error: "invalid_workbench_onboarding_payload";
      fields: string[];
      message: string;
    }
  | {
      status: "error";
      error: "onboarding_draft_invalid_json" | "onboarding_draft_failed";
      message: string;
    };

export type WorkbenchOnboardingSetupBoundary = (input: {
  userId: string;
}) => Promise<WorkbenchNotionSetupReport>;

export type WorkbenchOnboardingWriterBoundary = {
  appendManagedSection(input: {
    userId: string;
    pageId: string;
    pageTitle: WorkbenchOnboardingWritablePageTitle;
    heading: string;
    bullets: string[];
    source: "onboarding";
  }): Promise<{ status: "updated" | "skipped"; page_title?: string }>;
};

export type WorkbenchOnboardingConfigStore = {
  save(input: {
    userId: string;
    feedback_style: string;
    voice_register: string;
    friction_tasks: string[];
  }): Promise<{ status: "stored" | "skipped" | "error"; reason?: string }>;
};

export type WorkbenchOnboardingWritablePageTitle =
  | "Personal Profile"
  | "Working On"
  | "Voice";

export type WorkbenchOnboardingSaveResult =
  | {
      status: "profile_updated";
      message: string;
      pages: WorkbenchOnboardingWritablePageTitle[];
      config: { status: "stored" | "skipped" | "error"; reason?: string };
    }
  | {
      status: "invalid_payload";
      error: "invalid_workbench_onboarding_payload";
      fields: string[];
      message: string;
    }
  | {
      status: "invalid_draft";
      message: string;
    }
  | {
      status: "setup_needed";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

export function normalizeWorkbenchOnboardingPayload(
  input: WorkbenchOnboardingPayloadInput,
): WorkbenchOnboardingPayloadValidation {
  const roleTitle =
    normalizeString(input.role_title) ||
    normalizeUniqueStringList(
      [normalizeString(input.role), normalizeString(input.team)],
      2,
    ).join(", ");
  const currentFocus = normalizeInputStringList(
    input.current_focus_bullets ?? input.current_work_bullets,
    MAX_ONBOARDING_BULLETS,
  );
  const workTypes = normalizeUniqueStringList(
    [
      ...normalizeInputStringList(
        input.work_type_chips ?? input.friction_chips,
        MAX_ONBOARDING_BULLETS,
      ),
      normalizeString(input.work_type_other ?? input.friction_other),
    ],
    MAX_ONBOARDING_BULLETS,
  );
  const communicationStyle = normalizeInputStringList(
    input.communication_style ?? input.output_preference,
    MAX_ONBOARDING_BULLETS,
  );
  const challengeStyle = normalizeInputStringList(
    input.challenge_style ?? input.feedback_style,
    MAX_ONBOARDING_BULLETS,
  );
  const helpfulContext = normalizeUniqueStringList(
    [
      ...normalizeInputStringList(
        input.helpful_context ?? input.personal_context_bullets,
        MAX_ONBOARDING_BULLETS,
      ),
      normalizeString(input.helpful_context_other),
    ],
    MAX_ONBOARDING_BULLETS,
  );

  const fields: string[] = [];
  if (!roleTitle) fields.push("role_title");
  if (currentFocus.length === 0) fields.push("current_focus_bullets");
  if (workTypes.length === 0) fields.push("work_types");
  if (communicationStyle.length === 0) fields.push("communication_style");
  if (challengeStyle.length === 0) fields.push("challenge_style");

  if (fields.length > 0) {
    return {
      ok: false,
      error: "invalid_workbench_onboarding_payload",
      fields,
    };
  }

  return {
    ok: true,
    payload: {
      role_title: roleTitle,
      current_focus: currentFocus,
      work_types: workTypes,
      communication_style: communicationStyle,
      challenge_style: challengeStyle,
      helpful_context: helpfulContext,
    },
  };
}

export async function generateWorkbenchOnboardingDraft(input: {
  payload: WorkbenchOnboardingPayloadInput;
  modelClient: WorkbenchOnboardingModelClient;
}): Promise<WorkbenchOnboardingDraftResult> {
  const parsed = normalizeWorkbenchOnboardingPayload(input.payload);
  if (!parsed.ok) {
    return {
      status: "invalid_payload",
      error: parsed.error,
      fields: parsed.fields,
      message: "Add the missing setup details before generating a preview.",
    };
  }

  let raw: string;
  try {
    raw = await input.modelClient.create({
      system: [
        "You expand sparse Workbench onboarding notes into concise profile bullets.",
        "Return only strict JSON with personal_profile, working_on, and voice sections.",
        "Each section must contain 2-5 short bullets. Do not include sensitive or speculative claims.",
      ].join(" "),
      prompt: buildOnboardingDraftPrompt(parsed.payload),
      temperature: 0.2,
      maxTokens: 900,
    });
  } catch {
    return {
      status: "error",
      error: "onboarding_draft_failed",
      message:
        "Workbench could not generate a profile preview right now. Please try again.",
    };
  }

  const draft = parseWorkbenchOnboardingDraft(raw);
  if (!draft) {
    return {
      status: "error",
      error: "onboarding_draft_invalid_json",
      message:
        "Workbench could not turn that into a profile preview. Please try again.",
    };
  }

  return { status: "drafted", draft };
}

export async function saveWorkbenchOnboarding(input: {
  userId: string;
  payload: WorkbenchOnboardingPayloadInput;
  draft: WorkbenchOnboardingDraft;
  setup?: WorkbenchOnboardingSetupBoundary | null;
  writer?: WorkbenchOnboardingWriterBoundary | null;
  configStore?: WorkbenchOnboardingConfigStore | null;
}): Promise<WorkbenchOnboardingSaveResult> {
  const parsed = normalizeWorkbenchOnboardingPayload(input.payload);
  if (!parsed.ok) {
    return {
      status: "invalid_payload",
      error: parsed.error,
      fields: parsed.fields,
      message: "Add the missing setup details before saving your profile.",
    };
  }

  const draft = normalizeWorkbenchOnboardingDraft(input.draft);
  if (!draft) {
    return {
      status: "invalid_draft",
      message: "Generate a fresh profile preview before saving.",
    };
  }

  if (!input.setup || !input.writer) {
    return {
      status: "setup_needed",
      message: "Connect Notion to finish setting up your Workbench profile.",
    };
  }

  let setup: WorkbenchNotionSetupReport;
  try {
    setup = await input.setup({ userId: input.userId });
  } catch {
    return {
      status: "setup_needed",
      message: "Connect Notion to finish setting up your Workbench profile.",
    };
  }

  if (setup.status === "failed") {
    return {
      status: "setup_needed",
      message: "Connect Notion to finish setting up your Workbench profile.",
    };
  }

  const pageWrites = onboardingPageWrites(draft);
  try {
    for (const pageWrite of pageWrites) {
      const pageId = setup.child_ids[pageWrite.pageTitle];
      if (!pageId) {
        return {
          status: "setup_needed",
          message: "Connect Notion to finish setting up your Workbench profile.",
        };
      }

      await input.writer.appendManagedSection({
        userId: input.userId,
        pageId,
        pageTitle: pageWrite.pageTitle,
        heading: "Workbench onboarding",
        bullets: pageWrite.bullets,
        source: "onboarding",
      });
    }
  } catch {
    return {
      status: "error",
      message: "Workbench could not update your profile. Please try again.",
    };
  }

  const config =
    (await input.configStore?.save({
      userId: input.userId,
      feedback_style: parsed.payload.challenge_style.join("; "),
      voice_register: parsed.payload.communication_style.join("; "),
      friction_tasks: parsed.payload.work_types,
    })) ?? ({ status: "skipped" } as const);

  return {
    status: "profile_updated",
    message: "Your Workbench profile is set up.",
    pages: pageWrites.map((pageWrite) => pageWrite.pageTitle),
    config,
  };
}

export function createWorkbenchOnboardingAnthropicModelClient(input: {
  apiKey?: string | null;
  model?: string | null;
}): WorkbenchOnboardingModelClient | null {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  const model = input.model?.trim() || "claude-3-5-sonnet-latest";

  return {
    async create(request) {
      const response = await client.messages.create({
        model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
      });
      return response.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
    },
  };
}

function buildOnboardingDraftPrompt(payload: WorkbenchOnboardingPayload): string {
  return [
    "Create Workbench onboarding profile JSON from these staff signals.",
    "",
    `Role/title: ${payload.role_title}`,
    `Current focus: ${payload.current_focus.join("; ")}`,
    `Work types: ${payload.work_types.join("; ")}`,
    `Communication style: ${payload.communication_style.join("; ")}`,
    `Challenge style: ${payload.challenge_style.join("; ")}`,
    `Helpful working context: ${
      payload.helpful_context.length > 0
        ? payload.helpful_context.join("; ")
        : "none provided"
    }`,
    "",
    "Return JSON exactly shaped as:",
    '{"personal_profile":{"bullets":["..."]},"working_on":{"bullets":["..."]},"voice":{"bullets":["..."]}}',
  ].join("\n");
}

function parseWorkbenchOnboardingDraft(
  value: string,
): WorkbenchOnboardingDraft | null {
  try {
    return normalizeWorkbenchOnboardingDraft(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function normalizeWorkbenchOnboardingDraft(
  value: unknown,
): WorkbenchOnboardingDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<Record<keyof WorkbenchOnboardingDraft, unknown>>;
  const personalProfile = normalizePreviewBlock(draft.personal_profile);
  const workingOn = normalizePreviewBlock(draft.working_on);
  const voice = normalizePreviewBlock(draft.voice);

  if (!personalProfile || !workingOn || !voice) return null;
  return {
    personal_profile: personalProfile,
    working_on: workingOn,
    voice,
  };
}

function normalizePreviewBlock(value: unknown): WorkbenchOnboardingPreviewBlock | null {
  if (!value || typeof value !== "object") return null;
  const bullets = normalizeStringList(
    (value as { bullets?: unknown }).bullets,
    MAX_DRAFT_BULLETS,
  )
    .map((bullet) => limitString(bullet, MAX_DRAFT_BULLET_CHARS))
    .filter(Boolean);
  return bullets.length > 0 ? { bullets } : null;
}

function onboardingPageWrites(draft: WorkbenchOnboardingDraft): Array<{
  pageTitle: WorkbenchOnboardingWritablePageTitle;
  bullets: string[];
}> {
  return [
    { pageTitle: "Personal Profile", bullets: draft.personal_profile.bullets },
    { pageTitle: "Working On", bullets: draft.working_on.bullets },
    { pageTitle: "Voice", bullets: draft.voice.bullets },
  ];
}

function normalizeStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeString).filter(Boolean).slice(0, maxItems);
}

function normalizeInputStringList(value: unknown, maxItems: number): string[] {
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map(normalizeString)
      .filter(Boolean)
      .slice(0, maxItems);
  }

  return normalizeStringList(value, maxItems);
}

function normalizeUniqueStringList(
  values: readonly string[],
  maxItems: number,
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const item = normalizeString(value);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
    if (normalized.length >= maxItems) break;
  }
  return normalized;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function limitString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}

export function isWorkbenchOnboardingWritablePageTitle(
  value: WorkbenchNotionSetupChildTitle,
): value is WorkbenchOnboardingWritablePageTitle {
  return (
    value === "Personal Profile" || value === "Working On" || value === "Voice"
  );
}
