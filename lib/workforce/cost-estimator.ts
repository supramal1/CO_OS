export interface DispatchCostEstimateInput {
  agentId: string;
  model: string;
  promptChars: number;
  canDelegate: boolean;
}

export interface DispatchCostEstimate {
  lowUsd: number;
  highUsd: number;
  label: string;
}

interface AgentCostProfile {
  lowUsd: number;
  highUsd: number;
  defaultModelMultiplier: number;
}

const AGENT_COST_PROFILES: Record<string, AgentCostProfile> = {
  ada: { lowUsd: 1, highUsd: 5, defaultModelMultiplier: 5 },
  alan: { lowUsd: 0.3, highUsd: 2, defaultModelMultiplier: 5 },
  donald: { lowUsd: 0.1, highUsd: 1, defaultModelMultiplier: 1 },
  grace: { lowUsd: 0.5, highUsd: 5, defaultModelMultiplier: 1 },
  margaret: { lowUsd: 0.3, highUsd: 3, defaultModelMultiplier: 1 },
};

const FALLBACK_PROFILE: AgentCostProfile = {
  lowUsd: 0.5,
  highUsd: 3,
  defaultModelMultiplier: 1,
};

const DELEGATION_MULTIPLIER = 4;

export function estimateDispatchCost(
  input: DispatchCostEstimateInput,
): DispatchCostEstimate {
  const profile =
    AGENT_COST_PROFILES[input.agentId.toLowerCase()] ?? FALLBACK_PROFILE;
  const modelFactor =
    modelMultiplierFor(input.model) / profile.defaultModelMultiplier;
  const promptFactor = promptMultiplierFor(input.promptChars);
  const delegationFactor = input.canDelegate ? DELEGATION_MULTIPLIER : 1;

  const lowUsd = roundCurrency(
    profile.lowUsd * modelFactor * promptFactor * delegationFactor,
  );
  const highUsd = roundCurrency(
    profile.highUsd * modelFactor * promptFactor * delegationFactor,
  );

  return {
    lowUsd,
    highUsd,
    label: formatDispatchCostEstimate({ lowUsd, highUsd }),
  };
}

export function modelMultiplierFor(model: string): number {
  const normalized = model.toLowerCase();
  if (normalized.includes("opus")) return 5;
  if (normalized.includes("haiku")) return 0.33;
  return 1;
}

export function promptMultiplierFor(promptChars: number): number {
  const chars = Math.max(0, Math.floor(Number(promptChars) || 0));
  if (chars < 500) return 0.5;
  if (chars > 2_000) return 2;
  return 1;
}

export function formatDispatchCostEstimate(input: {
  lowUsd: number;
  highUsd: number;
}): string {
  return `Estimated: ~${formatLowerBound(input.lowUsd)}-${formatUpperBound(
    input.highUsd,
  )}`;
}

function formatLowerBound(value: number): string {
  const normalized = Math.max(0, Number(value) || 0);
  if (normalized < 1) return `$${normalized.toFixed(2)}`;
  if (normalized < 10) return `$${Math.max(1, Math.floor(normalized))}`;
  return `$${Math.max(1, Math.floor(normalized / 5) * 5)}`;
}

function formatUpperBound(value: number): string {
  const normalized = Math.max(0, Number(value) || 0);
  if (normalized < 1) return `$${normalized.toFixed(2)}`;
  if (normalized < 10) return `$${Math.ceil(normalized)}`;
  return `$${Math.ceil(normalized / 5) * 5}`;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
