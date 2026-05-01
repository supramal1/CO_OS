import type { Session } from "next-auth";
import {
  CONNECTED_TOOL_ROWS,
  PROFILE_FACT_ROWS,
  PROFILE_STATS,
  type ConnectedToolRow,
  type ProfileFactRow,
  type ProfilePersonalisationSnapshot,
  type ProfileIdentity,
  type ProfileSnapshot,
  type ProfileStateFreshness,
  type ProfileStat,
} from "./profile-model";
import {
  cleanPersonalisationContextText,
  extractPersonalisationContextText,
} from "./personalisation-context";
import {
  profileStateCacheKey,
  readProfileStateCache,
  type ProfileCacheClock,
  type ProfileCachedState,
} from "./profile-cache";
import { withProfileTiming } from "./profile-observability";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import {
  listWorkbenchConnectorManagementStatuses,
  type WorkbenchConnectorManagementResponse,
} from "@/lib/workbench/connector-management";
import {
  getMondayConnectionStatus,
  type MondayConnectionStatus,
} from "@/lib/monday/status";

export type BuildProfileSnapshotDependencies = {
  listConnectorStatuses?: (input: {
    userId: string;
  }) => Promise<WorkbenchConnectorManagementResponse[]>;
  loadPersonalisationCards?: (input: {
    userId: string;
    apiKey?: string | null;
  }) => Promise<ProfilePersonalisationSnapshot>;
  getMondayStatus?: (input: { userId: string }) => MondayConnectionStatus;
  connectorStatusTimeoutMs?: number;
  mondayStatusTimeoutMs?: number;
  personalisationTimeoutMs?: number;
  clock?: ProfileCacheClock;
};

const DEFAULT_CONNECTOR_STATUS_TIMEOUT_MS = 8000;
const DEFAULT_MONDAY_STATUS_TIMEOUT_MS = 3000;
const DEFAULT_PERSONALISATION_TIMEOUT_MS = 8000;

export type ProfileShellSnapshot = {
  identity: ProfileIdentity;
  stats: ProfileStat[];
  factRows: ProfileFactRow[];
};

export type ProfileConnectorsSnapshot = {
  connectedTools: ConnectedToolRow[];
  stats: ProfileStat[];
  metadata: ProfileStateFreshness;
};

export type ProfilePersonalisationSegmentSnapshot = {
  personalisation: ProfilePersonalisationSnapshot;
  metadata: ProfileStateFreshness;
};

export type ProfilePrivacySnapshot = {
  factRows: ProfileFactRow[];
};

export async function buildProfileSnapshot(input: {
  session: Session;
  apiKey?: string | null;
  deps?: BuildProfileSnapshotDependencies;
}): Promise<ProfileSnapshot> {
  const identity = buildProfileIdentity(input.session);
  const [connectors, personalisation] = await Promise.all([
    buildProfileConnectorsSnapshot({ session: input.session, deps: input.deps }),
    buildProfilePersonalisationSegmentSnapshot({
      session: input.session,
      apiKey: input.apiKey,
      deps: input.deps,
    }),
  ]);

  return {
    identity,
    stats: connectors.stats,
    factRows: PROFILE_FACT_ROWS,
    connectedTools: connectors.connectedTools,
    personalisation: personalisation.personalisation,
    metadata: {
      connectors: connectors.metadata,
      personalisation: personalisation.metadata,
    },
  };
}

export function buildProfileShellSnapshot(session: Session): ProfileShellSnapshot {
  return {
    identity: buildProfileIdentity(session),
    stats: PROFILE_STATS,
    factRows: PROFILE_FACT_ROWS.slice(0, 3),
  };
}

export async function buildProfileConnectorsSnapshot(input: {
  session: Session;
  deps?: BuildProfileSnapshotDependencies;
}): Promise<ProfileConnectorsSnapshot> {
  const userId = buildProfileIdentity(input.session).userId;
  const cached = await readProfileStateCache({
    key: profileStateCacheKey(userId, "connectors"),
    load: () =>
      withProfileTiming(
        { area: "profile", label: "connectors", userId },
        () => buildConnectedTools(userId, input.deps),
      ),
    clock: input.deps?.clock,
    isUsable: isUsableConnectedToolsSnapshot,
  });
  const connectedTools = withLastChecked(cached.value, cached.lastChecked);
  return {
    connectedTools,
    stats: buildProfileStats(connectedTools),
    metadata: freshnessFromCached(cached),
  };
}

export async function buildProfilePersonalisationSnapshot(input: {
  session: Session;
  apiKey?: string | null;
  deps?: BuildProfileSnapshotDependencies;
}): Promise<ProfilePersonalisationSnapshot> {
  const segment = await buildProfilePersonalisationSegmentSnapshot(input);
  return segment.personalisation;
}

export async function buildProfilePersonalisationSegmentSnapshot(input: {
  session: Session;
  apiKey?: string | null;
  deps?: BuildProfileSnapshotDependencies;
}): Promise<ProfilePersonalisationSegmentSnapshot> {
  const userId = buildProfileIdentity(input.session).userId;
  const cached = await readProfileStateCache({
    key: profileStateCacheKey(userId, "personalisation"),
    load: () =>
      withProfileTiming(
        { area: "profile", label: "personalisation", userId, slowMs: 900 },
        () => buildPersonalisation(userId, input.apiKey, input.deps),
      ),
    clock: input.deps?.clock,
    isUsable: (personalisation) =>
      personalisation.cards.length > 0 ||
      personalisation.sources.some((source) => source.status === "ok"),
  });
  return {
    personalisation: withPersonalisationLastChecked(
      cached.value,
      cached.lastChecked,
    ),
    metadata: freshnessFromCached(cached),
  };
}

export function buildProfilePrivacySnapshot(): ProfilePrivacySnapshot {
  return {
    factRows: PROFILE_FACT_ROWS.slice(3),
  };
}

export function buildFastProfileSnapshot(
  session: Session,
  deps: Pick<BuildProfileSnapshotDependencies, "clock"> = {},
): ProfileSnapshot {
  const identity = buildProfileIdentity(session);
  return {
    identity,
    stats: PROFILE_STATS,
    factRows: PROFILE_FACT_ROWS,
    connectedTools: CONNECTED_TOOL_ROWS,
    personalisation: {
      cards: [],
      sources: [
        {
          source: "honcho",
          status: "empty",
          label: "Honcho",
          detail: "Profile personalisation is loading.",
        },
      ],
    },
    metadata: {
      connectors: initialFreshness(deps.clock),
      personalisation: initialFreshness(deps.clock),
    },
  };
}

function buildProfileIdentity(session: Session): ProfileIdentity {
  const email = session.user?.email ?? "Login email unavailable";
  const name = session.user?.name ?? email;
  const userId = session.principalId ?? email;

  return {
    userId,
    name,
    email,
    role: session.isAdmin ? "admin" : "staff",
    teamSlugs: [],
    workspaceSlugs: [],
    cornerstonePrincipalId: session.principalId ?? undefined,
    activeProjectIds: [],
    activeClientIds: [],
  };
}

async function buildConnectedTools(
  userId: string,
  deps: BuildProfileSnapshotDependencies = {},
): Promise<ConnectedToolRow[]> {
  const listConnectorStatuses =
    deps.listConnectorStatuses ?? listWorkbenchConnectorManagementStatuses;
  const resolveMondayStatus = deps.getMondayStatus ?? getMondayConnectionStatus;
  const [connectorResult, mondayResult] = await Promise.all([
    loadBoundedSource(
      () => listConnectorStatuses({ userId }),
      deps.connectorStatusTimeoutMs ?? DEFAULT_CONNECTOR_STATUS_TIMEOUT_MS,
    ),
    loadBoundedSource(
      () => Promise.resolve(resolveMondayStatus({ userId })),
      deps.mondayStatusTimeoutMs ?? DEFAULT_MONDAY_STATUS_TIMEOUT_MS,
    ),
  ]);

  return CONNECTED_TOOL_ROWS.map((tool) => {
    if (tool.id === "notion") {
      return connectorResult.ok
        ? applyConnectorStatus(
            tool,
            connectorResult.value.find((status) => status.source === "notion"),
          )
        : applyConnectorUnavailable(tool);
    }
    if (tool.id === "google" || tool.id === "calendar" || tool.id === "drive") {
      return connectorResult.ok
        ? applyConnectorStatus(
            tool,
            connectorResult.value.find(
              (status) => status.source === "google_workspace",
            ),
          )
        : applyConnectorUnavailable(tool);
    }
    if (tool.id === "monday") {
      return mondayResult.ok
        ? applyMondayStatus(tool, mondayResult.value)
        : applyMondayUnavailable(tool);
    }
    return tool;
  });
}

type BoundedSourceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "error" | "timeout" };

async function loadBoundedSource<T>(
  load: () => Promise<T>,
  timeoutMs: number,
): Promise<BoundedSourceResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<BoundedSourceResult<T>>((resolve) => {
    timeout = setTimeout(() => resolve({ ok: false, reason: "timeout" }), timeoutMs);
  });
  const sourcePromise = Promise.resolve()
    .then(load)
    .then(
      (value) => ({ ok: true, value }) as const,
      () => ({ ok: false, reason: "error" }) as const,
    );

  try {
    return await Promise.race([sourcePromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function applyConnectorUnavailable(tool: ConnectedToolRow): ConnectedToolRow {
  return {
    ...tool,
    status: "needs_setup",
    actionLabel: tool.actionLabel === "Connect" ? "Connect" : "Try again",
    connectedAs: "Loading latest connection state.",
  };
}

function applyMondayUnavailable(tool: ConnectedToolRow): ConnectedToolRow {
  return {
    ...tool,
    status: "needs_setup",
    meta: "Status unavailable",
    actionLabel: "Try again",
    href: "/api/monday/status",
    connectedAs: "Loading latest monday connection state.",
    displayState: "repair_needed",
  };
}

function applyMondayStatus(
  tool: ConnectedToolRow,
  status: MondayConnectionStatus,
): ConnectedToolRow {
  return {
    ...tool,
    status: status.connected ? "connected" : "needs_setup",
    actionLabel: status.actionLabel,
    href: status.nextUrl,
    connectedAs: status.message,
    meta: status.configured ? "Identity" : "Setup",
  };
}

function applyConnectorStatus(
  tool: ConnectedToolRow,
  connector?: WorkbenchConnectorManagementResponse,
): ConnectedToolRow {
  if (!connector) return tool;

  if (connector.status === "ready" || connector.status === "accepted") {
    return {
      ...tool,
      status: "connected",
      actionLabel: "View",
      href: connector.next_url,
      connectedAs: connector.message ?? "Connected.",
    };
  }

  if (connector.status === "unavailable") {
    return {
      ...tool,
      status: "needs_setup",
      actionLabel: "Connect",
      href: connector.next_url,
      connectedAs: connector.message ?? "Not connected.",
    };
  }

  return {
    ...tool,
    status: "needs_setup",
    actionLabel: connector.next_url ? "Reconnect" : "Repair",
    href: connector.next_url,
    connectedAs: connector.message ?? connector.reason ?? "Needs attention.",
  };
}

function buildProfileStats(connectedTools: ConnectedToolRow[]): ProfileStat[] {
  const connectedCount = connectedTools.filter(
    (tool) => tool.status === "connected",
  ).length;
  const total = connectedTools.length;

  return PROFILE_STATS.map((stat) =>
    stat.label === "Connected tools"
      ? { ...stat, value: `${connectedCount} / ${total}` }
      : stat,
  );
}

function isUsableConnectedToolsSnapshot(tools: ConnectedToolRow[]): boolean {
  return (
    tools.length > 0 &&
    tools.every(
      (tool) =>
        tool.connectedAs !== "Connection state unavailable." &&
        tool.connectedAs !== "monday connection state unavailable." &&
        tool.connectedAs !== "Loading latest connection state." &&
        tool.connectedAs !== "Loading latest monday connection state.",
    )
  );
}

async function buildPersonalisation(
  userId: string,
  apiKey: string | null | undefined,
  deps: BuildProfileSnapshotDependencies = {},
): Promise<ProfilePersonalisationSnapshot> {
  const loadPersonalisationCards =
    deps.loadPersonalisationCards ?? loadCornerstonePersonalisationCards;
  const result = await loadBoundedSource(
    () => loadPersonalisationCards({ userId, apiKey }),
    deps.personalisationTimeoutMs ?? DEFAULT_PERSONALISATION_TIMEOUT_MS,
  );
  if (result.ok) return result.value;
  return {
    cards: [],
    sources: [
      {
        source: "honcho",
        status: "empty",
        label: "Honcho",
        detail: "Loading latest personalisation state.",
      },
    ],
  };
}

async function loadCornerstonePersonalisationCards(input: {
  userId: string;
  apiKey?: string | null;
}): Promise<ProfilePersonalisationSnapshot> {
  if (!input.apiKey) {
    return {
      cards: [],
      sources: [
        {
          source: "honcho",
          status: "unavailable",
          label: "Honcho",
          detail: "Cornerstone API key unavailable.",
        },
        {
          source: "notion",
          status: "empty",
          label: "Notion",
          detail: "Explicit profile context not loaded in this snapshot.",
        },
      ],
    };
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeout = setTimeout(
      () => controller.abort(),
      DEFAULT_PERSONALISATION_TIMEOUT_MS,
    );
    const response = await fetch(`${CORNERSTONE_URL.replace(/\/+$/, "")}/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": input.apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        query:
          "CO OS staff personalisation: brief style, working preferences, do-not-assume rules, useful context, and recurring feedback patterns.",
        namespace: "default",
        detail_level: "minimal",
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      return {
        cards: [],
        sources: [
          {
            source: "honcho",
            status: "error",
            label: "Honcho",
            detail: `Cornerstone returned ${response.status}.`,
          },
        ],
      };
    }

    const text = cleanPersonalisationContextText(
      extractPersonalisationContextText(await response.text()),
    );
    if (!text) {
      return {
        cards: [],
        sources: [
          {
            source: "honcho",
            status: "empty",
            label: "Honcho",
            detail: "No learned preferences found yet.",
          },
        ],
      };
    }

    return {
      cards: [
        {
          id: "honcho-context-0",
          title: personalisationTitle(text),
          detail: boundedText(text, 900),
          source: "honcho",
          confidence: "medium",
          actions: ["keep", "correct", "remove"],
        },
      ],
      sources: [
        {
          source: "honcho",
          status: "ok",
          label: "Honcho",
          detail: "Learned from saved conversations and memory writes.",
        },
      ],
    };
  } catch (error) {
    return {
      cards: [],
      sources: [
        {
          source: "honcho",
          status: "error",
          label: "Honcho",
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function personalisationTitle(text: string): string {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("communication") ||
    normalized.includes("style") ||
    normalized.includes("tone")
  ) {
    return "Communication and work preferences";
  }
  if (
    normalized.includes("do not assume") ||
    normalized.includes("assumption")
  ) {
    return "Do-not-assume guidance";
  }
  if (
    normalized.includes("feedback") ||
    normalized.includes("coaching")
  ) {
    return "Feedback and coaching patterns";
  }
  return "Learned work preferences";
}

function boundedText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function initialFreshness(
  clock: ProfileCacheClock = () => new Date(),
): ProfileStateFreshness {
  const now = clock().toISOString();
  return {
    generatedAt: now,
    lastChecked: now,
    status: "live",
  };
}

function freshnessFromCached<T>(
  cached: ProfileCachedState<T>,
): ProfileStateFreshness {
  return {
    generatedAt: cached.generatedAt,
    lastChecked: cached.lastChecked,
    status: cached.status,
  };
}

function withLastChecked(
  tools: ConnectedToolRow[],
  lastCheckedAt: string,
): ConnectedToolRow[] {
  return tools.map((tool) => ({ ...tool, lastCheckedAt }));
}

function withPersonalisationLastChecked(
  snapshot: ProfilePersonalisationSnapshot,
  lastCheckedAt: string,
): ProfilePersonalisationSnapshot {
  return {
    cards: snapshot.cards.map((card) => ({ ...card, lastCheckedAt })),
    sources: snapshot.sources.map((source) => ({ ...source, lastCheckedAt })),
  };
}
