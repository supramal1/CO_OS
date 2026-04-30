export const PROFILE_PATH = "/profile" as const;

export type ProfileSectionId =
  | "my-work"
  | "connected-tools"
  | "personalisation"
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
};

export const PROFILE_SECTIONS: ProfileSection[] = [
  {
    id: "my-work",
    title: "My Work",
    description:
      "Active clients, active projects, current workstreams, and default reviewer.",
  },
  {
    id: "connected-tools",
    title: "Connected Tools",
    description:
      "Manage the accounts CO OS uses for context, signals, and approved write-backs.",
  },
  {
    id: "personalisation",
    title: "Personalisation",
    description:
      "Preferred output length, tone, useful context pages, and learned preferences.",
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
  },
  {
    id: "calendar",
    label: "Google Calendar",
    role: "Meetings, prep needs, and daily schedule signals",
    status: "needs_setup",
  },
  {
    id: "drive",
    label: "Google Drive",
    role: "Artefact links and future project file context",
    status: "coming_next",
  },
  {
    id: "notion",
    label: "Notion",
    role: "Second-brain context and Workbench knowledge pages",
    status: "needs_setup",
  },
  {
    id: "monday",
    label: "monday.com",
    role: "Operational task ledger",
    status: "coming_next",
  },
  {
    id: "cornerstone",
    label: "Cornerstone",
    role: "Durable memory and project context",
    status: "connected",
  },
];
