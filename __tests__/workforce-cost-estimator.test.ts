import { describe, expect, it } from "vitest";
import {
  estimateDispatchCost,
  formatDispatchCostEstimate,
} from "@/lib/workforce/cost-estimator";

describe("estimateDispatchCost", () => {
  it("keeps the approved per-agent baseline ranges", () => {
    expect(base("ada")).toEqual({ lowUsd: 1, highUsd: 5 });
    expect(base("alan")).toEqual({ lowUsd: 0.3, highUsd: 2 });
    expect(base("donald")).toEqual({ lowUsd: 0.1, highUsd: 1 });
    expect(base("grace")).toEqual({ lowUsd: 0.5, highUsd: 5 });
    expect(base("margaret")).toEqual({ lowUsd: 0.3, highUsd: 3 });
  });

  it("applies model multipliers relative to the agent default", () => {
    expect(
      estimateDispatchCost({
        agentId: "grace",
        model: "claude-opus-4-7",
        promptChars: 1_000,
        canDelegate: false,
      }),
    ).toMatchObject({ lowUsd: 2.5, highUsd: 25 });

    expect(
      estimateDispatchCost({
        agentId: "grace",
        model: "claude-haiku-4-5-20251001",
        promptChars: 1_000,
        canDelegate: false,
      }),
    ).toMatchObject({ lowUsd: 0.17, highUsd: 1.65 });

    expect(
      estimateDispatchCost({
        agentId: "ada",
        model: "claude-opus-4-7",
        promptChars: 1_000,
        canDelegate: false,
      }),
    ).toMatchObject({ lowUsd: 1, highUsd: 5 });
  });

  it("adjusts ranges by prompt size", () => {
    expect(
      estimateDispatchCost({
        agentId: "grace",
        model: "claude-sonnet-4-6",
        promptChars: 499,
        canDelegate: false,
      }),
    ).toMatchObject({ lowUsd: 0.25, highUsd: 2.5 });

    expect(
      estimateDispatchCost({
        agentId: "grace",
        model: "claude-sonnet-4-6",
        promptChars: 500,
        canDelegate: false,
      }),
    ).toMatchObject({ lowUsd: 0.5, highUsd: 5 });

    expect(
      estimateDispatchCost({
        agentId: "grace",
        model: "claude-sonnet-4-6",
        promptChars: 2_001,
        canDelegate: false,
      }),
    ).toMatchObject({ lowUsd: 1, highUsd: 10 });
  });

  it("expands the range for delegation-heavy lead work", () => {
    const estimate = estimateDispatchCost({
      agentId: "ada",
      model: "claude-opus-4-7",
      promptChars: 1_000,
      canDelegate: true,
    });

    expect(estimate).toMatchObject({ lowUsd: 4, highUsd: 20 });
    expect(6.611997).toBeGreaterThanOrEqual(estimate.lowUsd);
    expect(6.611997).toBeLessThanOrEqual(estimate.highUsd);
  });
});

describe("formatDispatchCostEstimate", () => {
  it("formats a compact order-of-magnitude estimate", () => {
    expect(
      formatDispatchCostEstimate({
        lowUsd: 4,
        highUsd: 20,
      }),
    ).toBe("Estimated: ~$4-$20");

    expect(
      formatDispatchCostEstimate({
        lowUsd: 0.1,
        highUsd: 1,
      }),
    ).toBe("Estimated: ~$0.10-$1");
  });
});

function base(agentId: string) {
  const estimate = estimateDispatchCost({
    agentId,
    model: defaultModelFor(agentId),
    promptChars: 1_000,
    canDelegate: false,
  });
  return {
    lowUsd: estimate.lowUsd,
    highUsd: estimate.highUsd,
  };
}

function defaultModelFor(agentId: string): string {
  return agentId === "ada" || agentId === "alan"
    ? "claude-opus-4-7"
    : "claude-sonnet-4-6";
}
