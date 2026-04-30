import baselines from "@/config/workbench-hours-baselines.json";

const BASELINES: Record<string, number> = baselines;

export function estimatedBeforeMinutesFor(taskType: string): number {
  return BASELINES[taskType] ?? BASELINES.ask_decode;
}

export function workbenchBaselineTaskTypes(): string[] {
  return Object.keys(BASELINES);
}
