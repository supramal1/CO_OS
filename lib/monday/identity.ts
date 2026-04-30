export type MondayIdentityConfidence = "high" | "low";

export type MondayResolvedIdentity = {
  mondayUserId: string;
  mondayAccountId: string;
  name?: string;
  email?: string;
  confidence: MondayIdentityConfidence;
  confirmationRequired: boolean;
};

export type MondayIdentityStatus =
  | "not_configured"
  | "disconnected"
  | "resolved"
  | "confirmation_required";

export type MondayIdentityResolution = {
  source: "monday";
  status: MondayIdentityStatus;
  configured: boolean;
  identity: MondayResolvedIdentity | null;
  message: string;
};

export type MondayIdentityCandidate = {
  mondayUserId: string;
  mondayAccountId: string;
  name?: string;
  email?: string;
};

export type MondayIdentityConfirmStatus =
  | "accepted"
  | "invalid"
  | "unavailable";

export type MondayIdentityConfirmResult = {
  accepted: boolean;
  status: MondayIdentityConfirmStatus;
  message: string;
  identity: MondayResolvedIdentity | null;
};

export type MondayIdentityConfirmationStore = (input: {
  userId: string;
  identity: MondayResolvedIdentity;
}) => Promise<void>;

export function resolveMondayIdentity(input: {
  userId: string;
  name?: string | null;
  email?: string | null;
  candidate?: MondayIdentityCandidate | null;
  env?: Partial<Pick<NodeJS.ProcessEnv, "MONDAY_CLIENT_ID" | "MONDAY_CLIENT_SECRET">>;
}): MondayIdentityResolution {
  const env = input.env ?? process.env;
  const configured = Boolean(env.MONDAY_CLIENT_ID && env.MONDAY_CLIENT_SECRET);

  if (!configured) {
    return {
      source: "monday",
      status: "not_configured",
      configured: false,
      identity: null,
      message: "monday connector is not configured yet.",
    };
  }

  if (!input.candidate) {
    return {
      source: "monday",
      status: "disconnected",
      configured: true,
      identity: null,
      message: "Connect monday to resolve identity.",
    };
  }

  const identity = buildResolvedIdentity({
    signedInEmail: input.email,
    candidate: input.candidate,
  });

  return {
    source: "monday",
    status: identity.confirmationRequired ? "confirmation_required" : "resolved",
    configured: true,
    identity,
    message: identity.confirmationRequired
      ? "monday identity needs confirmation before setup continues."
      : "monday identity resolved from the signed-in email.",
  };
}

export async function confirmMondayIdentity(input: {
  userId: string;
  payload: unknown;
  storeConfirmation?: MondayIdentityConfirmationStore;
}): Promise<MondayIdentityConfirmResult> {
  const candidate = parseConfirmationPayload(input.payload);

  if (!candidate) {
    return {
      accepted: false,
      status: "invalid",
      message: "mondayUserId and mondayAccountId are required.",
      identity: null,
    };
  }

  const identity = buildResolvedIdentity({
    signedInEmail: candidate.email,
    candidate,
  });

  if (!input.storeConfirmation) {
    return {
      accepted: false,
      status: "unavailable",
      message: "monday identity confirmation persistence is not available yet.",
      identity,
    };
  }

  await input.storeConfirmation({
    userId: input.userId,
    identity,
  });

  return {
    accepted: true,
    status: "accepted",
    message: "monday identity confirmed.",
    identity,
  };
}

function buildResolvedIdentity(input: {
  signedInEmail?: string | null;
  candidate: MondayIdentityCandidate;
}): MondayResolvedIdentity {
  const emailMatches =
    normaliseEmail(input.signedInEmail) !== null &&
    normaliseEmail(input.signedInEmail) === normaliseEmail(input.candidate.email);

  return {
    mondayUserId: input.candidate.mondayUserId,
    mondayAccountId: input.candidate.mondayAccountId,
    ...(input.candidate.name ? { name: input.candidate.name } : {}),
    ...(input.candidate.email ? { email: input.candidate.email } : {}),
    confidence: emailMatches ? "high" : "low",
    confirmationRequired: !emailMatches,
  };
}

function parseConfirmationPayload(payload: unknown): MondayIdentityCandidate | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;

  const mondayUserId = nonEmptyString(body.mondayUserId);
  const mondayAccountId = nonEmptyString(body.mondayAccountId);
  if (!mondayUserId || !mondayAccountId) return null;

  const name = nonEmptyString(body.name);
  const email = nonEmptyString(body.email);

  return {
    mondayUserId,
    mondayAccountId,
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
  };
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseEmail(value: unknown): string | null {
  return nonEmptyString(value)?.toLowerCase() ?? null;
}
