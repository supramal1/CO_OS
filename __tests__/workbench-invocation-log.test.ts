import { describe, expect, it } from "vitest";
import { buildWorkbenchInvocationLog } from "@/lib/workbench/invocation-log";

describe("Workbench invocation log metadata", () => {
  it("includes the authenticated user id and skill version", () => {
    const createdAt = new Date("2026-04-29T10:00:00.000Z");
    const log = buildWorkbenchInvocationLog({
      userId: "principal_123",
      invocationType: "preflight",
      taskType: "ask_decode",
      skillName: "workbench-preflight",
      skillVersion: "0.1.0",
      estimatedBeforeMinutes: 30,
      latencyMs: 1400,
      ask: "Need help with an EM ask",
      status: "succeeded",
      createdAt,
    });

    expect(log).toMatchObject({
      user_id: "principal_123",
      invocation_type: "preflight",
      task_type: "ask_decode",
      skill_name: "workbench-preflight",
      skill_version: "0.1.0",
      estimated_before_minutes: 30,
      latency_ms: 1400,
      ask_chars: 24,
      status: "succeeded",
      created_at: "2026-04-29T10:00:00.000Z",
    });
  });
});
