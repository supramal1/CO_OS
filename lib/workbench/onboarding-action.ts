import { createWorkbenchNotionClient } from "./notion-client";
import {
  appendWorkbenchNotionManagedSectionToPage,
  type WorkbenchNotionPageAppenderClient,
} from "./notion-writer";
import { ensureWorkbenchNotionSetup } from "./notion-setup";
import { createWorkbenchNotionTokenStore } from "./notion-token-store";
import {
  createWorkbenchOnboardingAnthropicModelClient,
  generateWorkbenchOnboardingDraft,
  saveWorkbenchOnboarding,
  type WorkbenchOnboardingConfigStore,
  type WorkbenchOnboardingDraft,
  type WorkbenchOnboardingModelClient,
  type WorkbenchOnboardingPayloadInput,
  type WorkbenchOnboardingSetupBoundary,
  type WorkbenchOnboardingWriterBoundary,
} from "./personalisation";
import { getUserWorkbenchConfig } from "./retrieval/config";
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
    const modelClient =
      input.dependencies?.modelClient === undefined
        ? createWorkbenchOnboardingAnthropicModelClient({
            apiKey: process.env.ANTHROPIC_API_KEY,
            model: process.env.ANTHROPIC_MODEL,
          })
        : input.dependencies.modelClient;

    const result = await generateWorkbenchOnboardingDraft({
      payload: onboardingPayload(input.body.payload),
      modelClient,
    });
    return { status: onboardingStatusCode(result.status), body: result };
  }

  if (action === "save") {
    const defaultDependencies = createDefaultOnboardingSaveDependencies(
      input.userId,
    );
    const result = await saveWorkbenchOnboarding({
      userId: input.userId,
      payload: onboardingPayload(input.body.payload),
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
