import type { Session } from "next-auth";
import {
  CONNECTED_TOOL_ROWS,
  PROFILE_FACT_ROWS,
  PROFILE_STATS,
  type ConnectedToolRow,
  type ProfilePersonalisationSnapshot,
  type ProfileIdentity,
  type ProfileSnapshot,
  type ProfileStat,
} from "./profile-model";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import {
  listWorkbenchConnectorManagementStatuses,
  type WorkbenchConnectorManagementResponse,
} from "@/lib/workbench/connector-management";

export type BuildProfileSnapshotDependencies = {
  listConnectorStatuses?: (input: {
    userId: string;
  }) => Promise<WorkbenchConnectorManagementResponse[]>;
  loadPersonalisationCards?: (input: {
    userId: string;
    apiKey?: string | null;
  }) => Promise<ProfilePersonalisationSnapshot>;
};

export async function buildProfileSnapshot(input: {
  session: Session;
  apiKey?: string | null;
  deps?: BuildProfileSnapshotDependencies;
}): Promise<ProfileSnapshot> {
  const identity = buildProfileIdentity(input.session);
  const [connectedTools, personalisation] = await Promise.all([
    buildConnectedTools(identity.userId, input.deps),
    buildPersonalisation(identity.userId, input.apiKey, input.deps),
  ]);

  return {
    identity,
    stats: buildProfileStats(connectedTools),
    factRows: PROFILE_FACT_ROWS,
    connectedTools,
    personalisation,
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

  try {
    const statuses = await listConnectorStatuses({ userId });
    return CONNECTED_TOOL_ROWS.map((tool) => {
      if (tool.id === "notion") {
        return applyConnectorStatus(
          tool,
          statuses.find((status) => status.source === "notion"),
        );
      }
      if (tool.id === "google" || tool.id === "calendar" || tool.id === "drive") {
        return applyConnectorStatus(
          tool,
          statuses.find((status) => status.source === "google_workspace"),
        );
      }
      return tool;
    });
  } catch {
    return CONNECTED_TOOL_ROWS.map((tool) => {
      if (
        tool.id === "notion" ||
        tool.id === "google" ||
        tool.id === "calendar" ||
        tool.id === "drive"
      ) {
        return {
          ...tool,
          status: "needs_setup",
          actionLabel: "Try again",
          connectedAs: "Connection state unavailable.",
        };
      }
      return tool;
    });
  }
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

async function buildPersonalisation(
  userId: string,
  apiKey: string | null | undefined,
  deps: BuildProfileSnapshotDependencies = {},
): Promise<ProfilePersonalisationSnapshot> {
  const loadPersonalisationCards =
    deps.loadPersonalisationCards ?? loadCornerstonePersonalisationCards;
  return loadPersonalisationCards({ userId, apiKey });
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

  try {
    const response = await fetch(`${CORNERSTONE_URL.replace(/\/+$/, "")}/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": input.apiKey,
      },
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

    const text = cleanPersonalisationText(extractCornerstoneText(await response.text()));
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
  }
}

function extractCornerstoneText(raw: string): string {
  if (!raw.trim()) return "";
  try {
    return textFromCornerstonePayload(JSON.parse(raw));
  } catch {
    return raw;
  }
}

function textFromCornerstonePayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";

  const record = payload as Record<string, unknown>;
  for (const key of ["context", "result", "answer", "content", "text"]) {
    const text = textFromCornerstonePayload(record[key]);
    if (text.trim()) return text;
  }
  return "";
}

function cleanPersonalisationText(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^===/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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
