import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { estimatedBeforeMinutesFor } from "./baselines";
import { buildWorkbenchInvocationLog } from "./invocation-log";
import { processWorkbenchRunLearning } from "./learning";
import { createWorkbenchNotionClient } from "./notion-client";
import { createWorkbenchNotionTokenStore } from "./notion-token-store";
import { persistWorkbenchInvocation } from "./persistence";
import { persistWorkbenchRun } from "./run-history";
import {
  WORKBENCH_PREFLIGHT_SKILL_NAME,
  buildPreflightPrompt,
  parseWorkbenchPreflightResult,
} from "./preflight";
import { gatherWorkbenchRetrieval } from "./retrieval";
import { getUserWorkbenchConfig } from "./retrieval/config";
import { loadWorkbenchSkill } from "./skill-loader";
import type { WorkbenchStartResponse } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

export type RunWorkbenchStartInput = {
  ask: string;
  userId: string;
  apiKey: string;
  anthropicApiKey: string;
};

export async function runWorkbenchStart(
  input: RunWorkbenchStartInput,
): Promise<WorkbenchStartResponse> {
  const started = performance.now();
  const skill = await loadWorkbenchSkill(
    input.apiKey,
    WORKBENCH_PREFLIGHT_SKILL_NAME,
  );
  const retrieval = await gatherWorkbenchRetrieval({
    ask: input.ask,
    userId: input.userId,
    apiKey: input.apiKey,
  });

  const anthropic = new Anthropic({ apiKey: input.anthropicApiKey });
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2200,
    system: [
      skill.content,
      "",
      "Workbench runtime instruction: return only JSON in the requested schema. Do not use em dashes.",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: buildPreflightPrompt({
          ask: input.ask,
          retrievedContext: retrieval.context,
          retrievalStatuses: retrieval.statuses,
          retrievalSources: retrieval.sources,
        }),
      },
    ],
  });

  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const result = parseWorkbenchPreflightResult(raw);
  const taskType =
    result.time_estimate.task_type || result.decoded_task.task_type || "ask_decode";
  const estimatedBeforeMinutes =
    result.time_estimate.estimated_before_minutes ||
    estimatedBeforeMinutesFor(taskType);
  result.time_estimate.estimated_before_minutes = estimatedBeforeMinutes;
  result.time_estimate.task_type = taskType;

  const invocation = buildWorkbenchInvocationLog({
    userId: input.userId,
    invocationType: "preflight",
    taskType,
    skillName: WORKBENCH_PREFLIGHT_SKILL_NAME,
    skillVersion: skill.version ?? null,
    estimatedBeforeMinutes,
    latencyMs: performance.now() - started,
    ask: input.ask,
    status: "succeeded",
  });

  await persistWorkbenchInvocation(invocation);
  const runHistory = await persistRunHistory({
    userId: input.userId,
    ask: input.ask,
    result,
    retrieval,
    invocation,
  });
  const profileUpdate = await learnFromRun({
    userId: input.userId,
    ask: input.ask,
    result,
    runHistory,
  });
  return {
    result,
    invocation,
    retrieval,
    run_history: runHistory,
    ...(profileUpdate ? { profile_update: profileUpdate } : {}),
  };
}

async function persistRunHistory(input: WorkbenchStartResponse & {
  userId: string;
  ask: string;
}): Promise<NonNullable<WorkbenchStartResponse["run_history"]>> {
  try {
    const outcome = await persistWorkbenchRun(input);
    if (outcome.status === "stored") {
      return {
        status: "stored",
        id: outcome.run.id,
        created_at: outcome.run.created_at,
      };
    }
    if (outcome.status === "unavailable") {
      return {
        status: "unavailable",
        reason: outcome.error,
      };
    }
    if (outcome.status === "error") {
      console.warn("[workbench] run history persistence failed:", outcome.detail);
      return {
        status: "error",
        reason: outcome.error,
        detail: outcome.detail,
      };
    }
    return {
      status: "error",
      reason: "workbench_run_history_failed",
      detail: "Unknown Workbench run history status.",
    };
  } catch (err) {
    const detail = errorMessage(err);
    console.warn("[workbench] run history persistence failed:", detail);
    return {
      status: "error",
      reason: "workbench_run_history_failed",
      detail,
    };
  }
}

async function learnFromRun(input: {
  userId: string;
  ask: string;
  result: WorkbenchStartResponse["result"];
  runHistory: NonNullable<WorkbenchStartResponse["run_history"]>;
}): Promise<WorkbenchStartResponse["profile_update"] | null> {
  if (input.runHistory.status !== "stored") return null;

  try {
    const config = await getUserWorkbenchConfig(input.userId);
    if (!config?.notion_parent_page_id?.trim()) {
      return processWorkbenchRunLearning({
        userId: input.userId,
        ask: input.ask,
        result: input.result,
        sourceRunId: input.runHistory.id,
        config,
        writerClient: null,
      });
    }

    const token = await createWorkbenchNotionTokenStore().get(input.userId);
    const accessToken = token?.accessToken?.trim();
    const notionBoundary = accessToken
      ? createWorkbenchNotionClient({ token: accessToken })
      : null;
    const writerClient =
      notionBoundary?.client?.appendBlockChildren &&
      notionBoundary.client.listChildPages
        ? {
            listChildPages: notionBoundary.client.listChildPages.bind(
              notionBoundary.client,
            ),
            appendBlockChildren:
              notionBoundary.client.appendBlockChildren.bind(notionBoundary.client),
          }
        : null;

    return processWorkbenchRunLearning({
      userId: input.userId,
      ask: input.ask,
      result: input.result,
      sourceRunId: input.runHistory.id,
      config,
      writerClient,
    });
  } catch (err) {
    const message = errorMessage(err);
    console.warn("[workbench] profile learning failed:", message);
    return {
      status: "error",
      message,
    };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
