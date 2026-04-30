import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { buildWorkbenchInvocationLog } from "./invocation-log";
import { persistWorkbenchInvocation } from "./persistence";
import {
  WORKBENCH_PRESEND_SKILL_NAME,
  buildPresendPrompt,
  parseWorkbenchPresendResult,
} from "./presend";
import { runWorkbenchPresendSaveBack } from "./presend-save-back";
import type {
  RunWorkbenchPresendInput,
  WorkbenchPresendInvocationLogRow,
  WorkbenchPresendResponse,
} from "./presend-types";
import { getUserWorkbenchConfig } from "./retrieval/config";
import { loadWorkbenchSkill } from "./skill-loader";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

export async function runWorkbenchPresend(
  input: RunWorkbenchPresendInput,
): Promise<WorkbenchPresendResponse> {
  const started = performance.now();
  const skill = await loadWorkbenchSkill(
    input.apiKey,
    WORKBENCH_PRESEND_SKILL_NAME,
  );

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
        content: buildPresendPrompt({
          preflightResult: input.preflightResult,
          draftInput: input.draftInput,
          artifactSpecInput: input.artifactSpecInput,
        }),
      },
    ],
  });

  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const result = parseWorkbenchPresendResult(raw);
  const saveBack = await runWorkbenchPresendSaveBack({
    result,
    userId: input.userId,
    now: input.now,
    getUserConfig: input.getUserConfig ?? getUserWorkbenchConfig,
    googleAccessTokenProvider: input.googleAccessTokenProvider,
    googleTokenStore: input.googleTokenStore,
    driveFetch: input.driveFetch,
    createDriveUploader: input.createDriveUploader,
  });
  const taskType = taskTypeFromPreflight(input.preflightResult);
  const estimatedBeforeMinutes = estimatedBeforeFromPreflight(
    input.preflightResult,
  );

  const invocation = {
    ...buildWorkbenchInvocationLog({
      userId: input.userId,
      invocationType: "presend",
      taskType,
      skillName: WORKBENCH_PRESEND_SKILL_NAME,
      skillVersion: skill.version ?? null,
      estimatedBeforeMinutes,
      latencyMs: performance.now() - started,
      ask: [input.draftInput, input.artifactSpecInput].filter(Boolean).join("\n"),
      status: "succeeded",
    }),
  } satisfies WorkbenchPresendInvocationLogRow;

  await persistWorkbenchInvocation(invocation);
  return { result, invocation, save_back: saveBack };
}

function taskTypeFromPreflight(value: unknown): string {
  const obj = asRecord(value);
  const decoded = asRecord(obj?.decoded_task);
  const timeEstimate = asRecord(obj?.time_estimate);
  return (
    asString(timeEstimate?.task_type) ||
    asString(decoded?.task_type) ||
    "draft_check"
  );
}

function estimatedBeforeFromPreflight(value: unknown): number {
  const obj = asRecord(value);
  const timeEstimate = asRecord(obj?.time_estimate);
  const estimated = timeEstimate?.estimated_before_minutes;
  return typeof estimated === "number" && Number.isFinite(estimated)
    ? estimated
    : 30;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
