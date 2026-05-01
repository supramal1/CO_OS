export const PROFILE_PATH = "/profile" as const;

export type ProfileSectionId =
  | "my-work"
  | "connected-tools"
  | "privacy";

export type ProfileSection = {
  id: ProfileSectionId;
  title: string;
  description: string;
};

export type ConnectedToolId =
  | "google"
  | "calendar"
  | "drive"
  | "notion"
  | "monday"
  | "cornerstone";

export type ConnectedToolRow = {
  id: ConnectedToolId;
  label: string;
  role: string;
  status: "connected" | "needs_setup" | "coming_next";
  meta: string;
  actionLabel: string;
  href?: string;
  connectedAs?: string;
  displayState?:
    | "not_configured"
    | "ready_to_connect"
    | "confirmation_needed"
    | "connected"
    | "repair_needed";
};

export type ConnectedToolDisplay = {
  statusLabel: string;
  statusKind: ConnectedToolRow["status"];
  meta: string;
  detail?: string;
  actionLabel: string;
  href?: string;
  actions?: ConnectedToolAction[];
};

export type ConnectedToolAction = {
  label: string;
  kind: "link" | "post" | "refresh";
  href?: string;
  endpoint?: string;
  payload?: Record<string, unknown>;
};

export type ProfileStat = {
  label: string;
  value: string;
  subValue?: string;
};

export type ProfileFactRow = {
  label: string;
  value: string;
  subValue?: string;
  actionLabel?: string;
};

export type ProfilePersonalisationSource = "honcho" | "notion" | "cornerstone";

export type ProfilePersonalisationCard = {
  id: string;
  title: string;
  detail: string;
  source: ProfilePersonalisationSource;
  confidence: "high" | "medium" | "low";
  actions: Array<"keep" | "correct" | "remove">;
};

export type ProfilePersonalisationSourceStatus = {
  source: ProfilePersonalisationSource;
  status: "ok" | "empty" | "unavailable" | "error";
  label: string;
  detail?: string;
};

export type ProfilePersonalisationSnapshot = {
  cards: ProfilePersonalisationCard[];
  sources: ProfilePersonalisationSourceStatus[];
};

export type ProfileIdentity = {
  userId: string;
  email: string;
  name?: string;
  role: "staff" | "manager" | "admin";
  jobTitle?: string;
  teamSlugs: string[];
  workspaceSlugs: string[];
  googleAccountId?: string;
  notionUserId?: string;
  mondayUserId?: string;
  mondayAccountId?: string;
  cornerstonePrincipalId?: string;
  activeProjectIds?: string[];
  activeClientIds?: string[];
};

export type ProfileSnapshot = {
  identity: ProfileIdentity;
  stats: ProfileStat[];
  factRows: ProfileFactRow[];
  connectedTools: ConnectedToolRow[];
  personalisation: ProfilePersonalisationSnapshot;
};

export const PROFILE_SECTIONS: ProfileSection[] = [
  {
    id: "my-work",
    title: "My Work",
    description: "Active clients, active projects, and current workstreams.",
  },
  {
    id: "connected-tools",
    title: "Connected Tools",
    description:
      "Manage the accounts CO OS uses for context, signals, and approved write-backs.",
  },
  {
    id: "privacy",
    title: "Privacy",
    description:
      "Understand what is private to you, visible to project teams, and admin-only.",
  },
];

export const CONNECTED_TOOL_ROWS: ConnectedToolRow[] = [
  {
    id: "google",
    label: "Google account",
    role: "Identity and OAuth foundation",
    status: "needs_setup",
    meta: "OAuth",
    actionLabel: "Connect",
  },
  {
    id: "calendar",
    label: "Google Calendar",
    role: "Meetings, prep needs, and daily schedule signals",
    status: "needs_setup",
    meta: "Read-only",
    actionLabel: "Connect",
  },
  {
    id: "drive",
    label: "Google Drive",
    role: "Artefact links and future project file context",
    status: "coming_next",
    meta: "Prepared",
    actionLabel: "Soon",
  },
  {
    id: "notion",
    label: "Notion",
    role: "Second-brain context and Workbench knowledge pages",
    status: "needs_setup",
    meta: "Workbench",
    actionLabel: "Connect",
  },
  {
    id: "monday",
    label: "monday.com",
    role: "Operational task ledger",
    status: "needs_setup",
    meta: "Setup",
    actionLabel: "Check status",
    href: "/api/monday/status",
    connectedAs: "monday connector has not been configured for this workspace yet.",
    displayState: "not_configured",
  },
  {
    id: "cornerstone",
    label: "Cornerstone",
    role: "Durable memory and project context",
    status: "connected",
    meta: "Default",
    actionLabel: "View",
  },
];

export function getConnectedToolDisplay(
  tool: ConnectedToolRow,
): ConnectedToolDisplay {
  if (tool.id !== "monday") {
    return {
      statusLabel:
        tool.status === "connected"
          ? "Connected"
          : tool.status === "coming_next"
            ? "Coming next"
            : "Needs setup",
      statusKind: tool.status,
      meta: tool.meta,
      detail: tool.connectedAs,
      actionLabel: tool.actionLabel,
      href: tool.href,
      actions: connectorActions(tool),
    };
  }

  const state = inferMondayDisplayState(tool);

  if (state === "not_configured") {
    return {
      statusLabel: "Not configured",
      statusKind: "needs_setup",
      meta: "Setup",
      detail:
        tool.connectedAs ??
        "An admin needs to finish monday setup before staff can connect.",
      actionLabel: "Check status",
      href: "/api/monday/status",
      actions: [{ label: "Check status", kind: "link", href: "/api/monday/status" }],
    };
  }

  if (state === "ready_to_connect") {
    return {
      statusLabel: "Ready to connect",
      statusKind: "needs_setup",
      meta: "Identity",
      detail:
        tool.connectedAs ??
        "Connect once and CO OS will resolve your monday identity.",
      actionLabel: "Connect",
      href: "/api/monday/start",
      actions: [{ label: "Connect", kind: "link", href: "/api/monday/start" }],
    };
  }

  if (state === "confirmation_needed") {
    return {
      statusLabel: "Confirm identity",
      statusKind: "needs_setup",
      meta: "Identity",
      detail:
        tool.connectedAs ??
        "Confirm the monday account CO OS found before it uses task context.",
      actionLabel: "Confirm",
      href: mondayStatusHref(tool.href),
      actions: [{ label: "Confirm", kind: "link", href: mondayStatusHref(tool.href) }],
    };
  }

  if (state === "repair_needed") {
    return {
      statusLabel: "Repair needed",
      statusKind: "needs_setup",
      meta: "Repair",
      detail:
        tool.connectedAs ??
        "Reconnect monday so CO OS can continue reading task signals.",
      actionLabel: tool.actionLabel === "Connect" ? "Reconnect" : tool.actionLabel,
      href: mondayStartHref(tool.href),
      actions: [{ label: "Reconnect", kind: "link", href: mondayStartHref(tool.href) }],
    };
  }

  return {
    statusLabel: connectedMondayLabel(tool.connectedAs),
    statusKind: "connected",
    meta: "Connected",
    detail: tool.connectedAs,
    actionLabel: tool.actionLabel === "Connect" ? "View" : tool.actionLabel,
    href: mondayStatusHref(tool.href),
    actions: [
      { label: "View", kind: "link", href: mondayStatusHref(tool.href) },
      { label: "Reconnect", kind: "link", href: "/api/monday/start" },
      { label: "Disconnect", kind: "link", href: "/api/monday/status" },
    ],
  };
}

function connectorActions(tool: ConnectedToolRow): ConnectedToolAction[] {
  const source = workbenchConnectorSource(tool.id);
  if (!source) {
    return tool.href ? [{ label: tool.actionLabel, kind: "link", href: tool.href }] : [];
  }

  const endpoint = `/api/workbench/connectors/${source}`;
  if (tool.status === "connected") {
    return [
      { label: "Disconnect", kind: "post", endpoint, payload: { action: "disconnect" } },
      { label: "Repair", kind: "post", endpoint, payload: { action: "repair" } },
      { label: "Reconnect", kind: "link", href: reconnectHref(tool, source) },
    ];
  }

  const primary =
    tool.actionLabel.toLowerCase() === "reconnect"
      ? "Reconnect"
      : tool.actionLabel.toLowerCase() === "repair"
        ? "Repair"
        : "Connect";
  return [
    primary === "Repair"
      ? { label: "Repair", kind: "post", endpoint, payload: { action: "repair" } }
      : { label: primary, kind: "link", href: reconnectHref(tool, source) },
    { label: "Check", kind: "link", href: endpoint },
  ];
}

function workbenchConnectorSource(id: ConnectedToolId): "notion" | "google_workspace" | null {
  if (id === "notion") return "notion";
  if (id === "google" || id === "calendar" || id === "drive") return "google_workspace";
  return null;
}

function reconnectHref(tool: ConnectedToolRow, source: "notion" | "google_workspace"): string {
  if (tool.href && tool.href !== "/profile") return tool.href;
  return source === "notion" ? "/api/workbench/notion/start" : "/workbench?google_oauth=start";
}

function inferMondayDisplayState(
  tool: ConnectedToolRow,
): NonNullable<ConnectedToolRow["displayState"]> {
  if (tool.displayState) return tool.displayState;

  const text = `${tool.actionLabel} ${tool.meta} ${tool.connectedAs ?? ""}`.toLowerCase();
  if (tool.status === "connected") return "connected";
  if (tool.actionLabel.toLowerCase() === "connect") return "ready_to_connect";
  if (text.includes("confirm")) return "confirmation_needed";
  if (
    text.includes("expired") ||
    text.includes("revoked") ||
    text.includes("repair") ||
    text.includes("reauth") ||
    text.includes("reconnect")
  ) {
    return "repair_needed";
  }
  return "not_configured";
}

function connectedMondayLabel(detail: string | undefined): string {
  if (!detail) return "Connected";
  const match = detail.match(/\bconnected as\s+(.+)$/i);
  if (match?.[1]) return `Connected as ${match[1].trim().replace(/[.!?]$/, "")}`;
  return "Connected";
}

function mondayStartHref(href: string | undefined): string {
  return href && href !== "/profile" ? href : "/api/monday/start";
}

function mondayStatusHref(href: string | undefined): string {
  return href && href !== "/profile" ? href : "/api/monday/status";
}

export const PROFILE_STATS: ProfileStat[] = [
  {
    label: "Active projects",
    value: "Not set",
    subValue: "Add from My Work",
  },
  {
    label: "Connected tools",
    value: "1 / 6",
    subValue: "Connector hub",
  },
];

export const PROFILE_FACT_ROWS: ProfileFactRow[] = [
  {
    label: "Role",
    value: "Staff member",
    subValue: "Used for surface defaults, not security permissions.",
  },
  {
    label: "Team",
    value: "Not set",
    subValue: "Admin-managed org grouping.",
  },
  {
    label: "Active work",
    value: "No active projects selected",
    subValue: "Controls relevance across Newsroom, Workbench, and connected tools.",
    actionLabel: "Add work",
  },
  {
    label: "Private to you",
    value: "Style preferences, dismissed Newsroom items",
  },
  {
    label: "Visible to team",
    value: "Project membership, shared decisions, approved artefacts",
  },
  {
    label: "Admin only",
    value: "Workspace permissions, connector health, audit logs",
  },
];
