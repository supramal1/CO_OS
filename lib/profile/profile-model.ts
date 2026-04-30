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
    status: "coming_next",
    meta: "Infrastructure",
    actionLabel: "Soon",
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
