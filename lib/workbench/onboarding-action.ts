import { createWorkbenchNotionClient } from "./notion-client";
import {
  retrieveWorkbenchNotionContext,
  type WorkbenchNotionClient,
} from "./notion";
import {
  appendWorkbenchNotionManagedSectionToPage,
  type WorkbenchNotionPageAppenderClient,
} from "./notion-writer";
import { ensureWorkbenchNotionSetup } from "./notion-setup";
import { createWorkbenchNotionTokenStore } from "./notion-token-store";
import {
  createWorkbenchOnboardingAnthropicModelClient,
  generateWorkbenchOnboardingDraft,
  normalizeWorkbenchOnboardingPayload,
  saveWorkbenchOnboarding,
  type WorkbenchOnboardingConfigStore,
  type WorkbenchOnboardingDraft,
  type WorkbenchOnboardingModelClient,
  type WorkbenchOnboardingPayloadInput,
  type WorkbenchOnboardingSetupBoundary,
  type WorkbenchOnboardingWriterBoundary,
} from "./personalisation";
import { compileWorkbenchProfile, type WorkbenchProfileContext } from "./profile";
import { getUserWorkbenchConfig } from "./retrieval/config";
import type { WorkbenchUserConfig } from "./retrieval/types";
import { patchWorkbenchUserConfig } from "./user-config";

export type WorkbenchOnboardingBody = {
  action?: unknown;
  payload?: unknown;
  draft?: unknown;
};

export type WorkbenchOnboardingDependencies = {
  modelClient?: WorkbenchOnboardingModelClient | null;
  setup?: WorkbenchOnboardingSetupBoundary | null;
  writer?: WorkbenchOnboardingWriterBoundary | null;
  configStore?: WorkbenchOnboardingConfigStore | null;
};

export async function runWorkbenchOnboardingAction(input: {
  userId: string;
  body: WorkbenchOnboardingBody;
  dependencies?: WorkbenchOnboardingDependencies;
}): Promise<{ status: number; body: unknown }> {
  const action = typeof input.body.action === "string" ? input.body.action : "";

  if (action === "draft") {
    const payload = await resolveOnboardingPayload(
      input.userId,
      input.body.payload,
    );
    const modelClient =
      input.dependencies?.modelClient === undefined
        ? createWorkbenchOnboardingAnthropicModelClient({
            apiKey: process.env.ANTHROPIC_API_KEY,
            model: process.env.ANTHROPIC_MODEL,
          })
        : input.dependencies.modelClient;

    const result = await generateWorkbenchOnboardingDraft({
      payload,
      modelClient,
    });
    return { status: onboardingStatusCode(result.status), body: result };
  }

  if (action === "save") {
    const payload = await resolveOnboardingPayload(
      input.userId,
      input.body.payload,
    );
    const defaultDependencies = createDefaultOnboardingSaveDependencies(
      input.userId,
    );
    const result = await saveWorkbenchOnboarding({
      userId: input.userId,
      payload,
      draft: input.body.draft as WorkbenchOnboardingDraft,
      setup: input.dependencies?.setup ?? defaultDependencies.setup,
      writer: input.dependencies?.writer ?? defaultDependencies.writer,
      configStore:
        input.dependencies?.configStore ?? defaultDependencies.configStore,
    });
    return { status: onboardingStatusCode(result.status), body: result };
  }

  return {
    status: 400,
    body: {
      error: "invalid_onboarding_action",
      valid_actions: ["draft", "save"],
    },
  };
}

function createDefaultOnboardingSaveDependencies(
  userId: string,
): Required<WorkbenchOnboardingDependencies> {
  let accessTokenPromise: Promise<string | null> | null = null;
  let notionClientPromise:
    | Promise<WorkbenchNotionPageAppenderClient | null>
    | null = null;

  const getAccessToken = async () => {
    accessTokenPromise ??= createWorkbenchNotionTokenStore()
      .get(userId)
      .then((token) => token?.accessToken?.trim() || null)
      .catch(() => null);
    return accessTokenPromise;
  };

  const getNotionClient = async () => {
    notionClientPromise ??= getAccessToken().then((accessToken) => {
      if (!accessToken) return null;
      const boundary = createWorkbenchNotionClient({ token: accessToken });
      if (!boundary.client?.appendBlockChildren) return null;
      return {
        appendBlockChildren: boundary.client.appendBlockChildren.bind(
          boundary.client,
        ),
      };
    });
    return notionClientPromise;
  };

  return {
    modelClient: null,
    setup: async (setupInput) => {
      const accessToken = await getAccessToken();
      if (!accessToken) return notionSetupUnavailable("notion_oauth_required");

      return ensureWorkbenchNotionSetup({
        userId: setupInput.userId,
        config: await getUserWorkbenchConfig(setupInput.userId),
        token: accessToken,
        updateConfig: async (update) => {
          await patchWorkbenchUserConfig(update.userId, {
            notion_parent_page_id: update.notion_parent_page_id,
          });
        },
      });
    },
    writer: {
      async appendManagedSection(sectionInput) {
        const client = await getNotionClient();
        const result = await appendWorkbenchNotionManagedSectionToPage({
          pageId: sectionInput.pageId,
          client,
          section: {
            page: sectionInput.pageTitle,
            heading: sectionInput.heading,
            items: sectionInput.bullets,
            sourceLabel: "Onboarding",
          },
        });

        if (result.status !== "written") {
          throw new Error(result.reason ?? "notion_profile_write_skipped");
        }

        return {
          status: "updated",
          page_title: sectionInput.pageTitle,
        };
      },
    },
    configStore: {
      async save(configInput) {
        const result = await patchWorkbenchUserConfig(configInput.userId, {
          feedback_style: configInput.feedback_style,
          voice_register: configInput.voice_register,
          friction_tasks: configInput.friction_tasks,
        });

        if (result.status === "ok") return { status: "stored" };
        return {
          status: result.status === "unavailable" ? "skipped" : "error",
          reason: result.status === "error" ? result.detail : result.error,
        };
      },
    },
  };
}

function onboardingPayload(value: unknown): WorkbenchOnboardingPayloadInput {
  return value && typeof value === "object"
    ? (value as WorkbenchOnboardingPayloadInput)
    : {};
}

async function resolveOnboardingPayload(
  userId: string,
  value: unknown,
): Promise<WorkbenchOnboardingPayloadInput> {
  const payload = onboardingPayload(value);
  if (normalizeWorkbenchOnboardingPayload(payload).ok) return payload;

  const defaults = await existingProfileDefaults(userId);
  return mergeOnboardingPayloadDefaults(payload, defaults);
}

async function existingProfileDefaults(
  userId: string,
): Promise<WorkbenchOnboardingPayloadInput> {
  const config = await getUserWorkbenchConfig(userId);
  const profile = await loadExistingWorkbenchProfile(userId, config);
  if (!profile.summary_text.trim() && !hasConfigProfileSignals(config)) return {};

  return {
    role_title:
      profile.role ?? (hasConfigProfileSignals(config) ? "Charlie Oscar staff member" : undefined),
    current_focus_bullets: firstNonEmptyList(
      profile.current_work,
      profile.working_context,
      config?.friction_tasks,
    ),
    work_type_chips: firstNonEmptyList(config?.friction_tasks, profile.current_work),
    communication_style: firstNonEmptyList(
      splitProfileLine(profile.communication_style),
      splitProfileLine(config?.voice_register),
    ),
    challenge_style: firstNonEmptyList(
      splitProfileLine(profile.challenge_style),
      splitProfileLine(config?.feedback_style),
    ),
    helpful_context: [
      ...profile.working_context,
      ...profile.do_not_assume.map((item) => `Do not assume: ${item}`),
    ],
  };
}

async function loadExistingWorkbenchProfile(
  userId: string,
  config: WorkbenchUserConfig | null,
): Promise<WorkbenchProfileContext> {
  const client = await getProfileNotionClient(userId);
  const notion = client
    ? await retrieveWorkbenchNotionContext({
        config,
        client,
        excerptMaxChars: 900,
      }).catch(() => null)
    : null;

  return compileWorkbenchProfile({
    notionItems: notion?.items ?? [],
    userConfig: config,
  });
}

async function getProfileNotionClient(
  userId: string,
): Promise<WorkbenchNotionClient | null> {
  const token = await createWorkbenchNotionTokenStore()
    .get(userId)
    .then((stored) => stored?.accessToken?.trim() || null)
    .catch(() => null);
  if (!token) return null;
  const boundary = createWorkbenchNotionClient({ token });
  return boundary.client ?? null;
}

function mergeOnboardingPayloadDefaults(
  payload: WorkbenchOnboardingPayloadInput,
  defaults: WorkbenchOnboardingPayloadInput,
): WorkbenchOnboardingPayloadInput {
  return {
    ...payload,
    role_title: hasString(payload.role_title)
      ? payload.role_title
      : defaults.role_title,
    current_focus_bullets: hasListInput(payload.current_focus_bullets)
      ? payload.current_focus_bullets
      : defaults.current_focus_bullets,
    work_type_chips: hasListInput(payload.work_type_chips)
      ? payload.work_type_chips
      : defaults.work_type_chips,
    work_type_other: hasString(payload.work_type_other)
      ? payload.work_type_other
      : defaults.work_type_other,
    communication_style: hasListInput(payload.communication_style)
      ? payload.communication_style
      : defaults.communication_style,
    challenge_style: hasListInput(payload.challenge_style)
      ? payload.challenge_style
      : defaults.challenge_style,
    helpful_context: hasListInput(payload.helpful_context)
      ? payload.helpful_context
      : defaults.helpful_context,
    helpful_context_other: hasString(payload.helpful_context_other)
      ? payload.helpful_context_other
      : defaults.helpful_context_other,
  };
}

function hasConfigProfileSignals(config: WorkbenchUserConfig | null): boolean {
  return Boolean(
    config?.notion_parent_page_id?.trim() ||
      config?.voice_register?.trim() ||
      config?.feedback_style?.trim() ||
      config?.friction_tasks?.some((item) => item.trim()),
  );
}

function firstNonEmptyList(
  ...lists: Array<readonly string[] | null | undefined>
): string[] {
  return (
    lists.find((list) => list?.some((item) => item.trim()))?.filter(Boolean) ??
    []
  );
}

function splitProfileLine(value: string | null | undefined): string[] {
  return value
    ? value
        .split(/[;\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function hasString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasListInput(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === "string" && item.trim());
  }
  return typeof value === "string" && value.trim().length > 0;
}

function onboardingStatusCode(status: string): number {
  if (status === "drafted" || status === "profile_updated") return 200;
  if (status === "invalid_payload" || status === "invalid_draft") return 400;
  if (status === "setup_needed") return 409;
  return 502;
}

function notionSetupUnavailable(reason: string): Awaited<
  ReturnType<WorkbenchOnboardingSetupBoundary>
> {
  return {
    status: "failed",
    parent_id: null,
    child_ids: {},
    counts: { created: 0, validated: 0, repaired: 0 },
    reason,
  };
}
