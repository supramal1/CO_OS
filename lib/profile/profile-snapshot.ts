import type { Session } from "next-auth";
import {
  CONNECTED_TOOL_ROWS,
  PROFILE_FACT_ROWS,
  PROFILE_STATS,
  type ConnectedToolRow,
  type ProfileIdentity,
  type ProfileSnapshot,
  type ProfileStat,
} from "./profile-model";
import {
  listWorkbenchConnectorManagementStatuses,
  type WorkbenchConnectorManagementResponse,
} from "@/lib/workbench/connector-management";

export type BuildProfileSnapshotDependencies = {
  listConnectorStatuses?: (input: {
    userId: string;
  }) => Promise<WorkbenchConnectorManagementResponse[]>;
};

export async function buildProfileSnapshot(input: {
  session: Session;
  deps?: BuildProfileSnapshotDependencies;
}): Promise<ProfileSnapshot> {
  const identity = buildProfileIdentity(input.session);
  const connectedTools = await buildConnectedTools(identity.userId, input.deps);

  return {
    identity,
    stats: buildProfileStats(connectedTools),
    factRows: PROFILE_FACT_ROWS,
    connectedTools,
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
