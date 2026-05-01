import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONNECTED_TOOL_ROWS,
  PROFILE_FACT_ROWS,
  PROFILE_PATH,
  PROFILE_SECTIONS,
  PROFILE_STATS,
  getConnectedToolDisplay,
} from "@/lib/profile/profile-model";

describe("My OS Profile model", () => {
  it("defines the Phase 1 profile destination and sections", () => {
    expect(PROFILE_PATH).toBe("/profile");
    expect(PROFILE_SECTIONS.map((section) => section.id)).toEqual([
      "my-work",
      "connected-tools",
      "privacy",
    ]);
    expect(PROFILE_SECTIONS.find((section) => section.id === "connected-tools")).toMatchObject({
      title: "Connected Tools",
      description:
        "Manage the accounts CO OS uses for context, signals, and approved write-backs.",
    });
  });

  it("starts Connected Tools with the OS-wide integration set", () => {
    expect(CONNECTED_TOOL_ROWS.map((tool) => tool.id)).toEqual([
      "google",
      "calendar",
      "drive",
      "notion",
      "monday",
      "cornerstone",
    ]);
    expect(CONNECTED_TOOL_ROWS.find((tool) => tool.id === "monday")).toMatchObject({
      label: "monday.com",
      role: "Operational task ledger",
      status: "needs_setup",
      actionLabel: "Check status",
      href: "/api/monday/status",
    });
  });

  it("keeps monday as infrastructure with clear Profile display states", () => {
    expect(
      getConnectedToolDisplay({
        id: "monday",
        label: "monday.com",
        role: "Operational task ledger",
        status: "needs_setup",
        meta: "Setup",
        actionLabel: "Set up",
        connectedAs: "monday connector has not been configured yet.",
      }),
    ).toMatchObject({
      statusLabel: "Not configured",
      actionLabel: "Check status",
      href: "/api/monday/status",
      meta: "Setup",
    });

    expect(
      getConnectedToolDisplay({
        id: "monday",
        label: "monday.com",
        role: "Operational task ledger",
        status: "needs_setup",
        meta: "Identity",
        actionLabel: "Connect",
        href: "/profile",
        connectedAs: "monday is ready to connect. Identity confirmation comes next.",
      }),
    ).toMatchObject({
      statusLabel: "Ready to connect",
      actionLabel: "Connect",
      href: "/api/monday/start",
      meta: "Identity",
    });

    expect(
      getConnectedToolDisplay({
        id: "monday",
        label: "monday.com",
        role: "Operational task ledger",
        status: "needs_setup",
        meta: "Identity",
        actionLabel: "Confirm",
        connectedAs: "Confirm Malik James-Williams before CO OS uses monday task context.",
      }),
    ).toMatchObject({
      statusLabel: "Confirm identity",
      actionLabel: "Confirm",
      href: "/api/monday/status",
    });

    expect(
      getConnectedToolDisplay({
        id: "monday",
        label: "monday.com",
        role: "Operational task ledger",
        status: "connected",
        meta: "Identity",
        actionLabel: "View",
        connectedAs: "Connected as Malik James-Williams.",
      }),
    ).toMatchObject({
      statusLabel: "Connected as Malik James-Williams",
      statusKind: "connected",
      actionLabel: "View",
    });

    expect(
      getConnectedToolDisplay({
        id: "monday",
        label: "monday.com",
        role: "Operational task ledger",
        status: "needs_setup",
        meta: "Identity",
        actionLabel: "Reconnect",
        href: "/profile",
        connectedAs: "monday token expired.",
      }),
    ).toMatchObject({
      statusLabel: "Repair needed",
      actionLabel: "Reconnect",
      href: "/api/monday/start",
      meta: "Repair",
    });
  });

  it("offers self-service connector actions from Profile", () => {
    expect(
      getConnectedToolDisplay({
        id: "notion",
        label: "Notion",
        role: "Second-brain context",
        status: "connected",
        meta: "Workbench",
        actionLabel: "View",
        connectedAs: "Notion workspace ready.",
      }).actions,
    ).toEqual([
      {
        label: "Disconnect",
        kind: "post",
        endpoint: "/api/workbench/connectors/notion",
        payload: { action: "disconnect" },
      },
      {
        label: "Repair",
        kind: "post",
        endpoint: "/api/workbench/connectors/notion",
        payload: { action: "repair" },
      },
      {
        label: "Reconnect",
        kind: "link",
        href: "/api/workbench/notion/start",
      },
    ]);

    expect(
      getConnectedToolDisplay({
        id: "google",
        label: "Google account",
        role: "Identity and OAuth foundation",
        status: "needs_setup",
        meta: "OAuth",
        actionLabel: "Reconnect",
        href: "/workbench?google_oauth=start",
      }).actions?.[0],
    ).toEqual({
      label: "Reconnect",
      kind: "link",
      href: "/workbench?google_oauth=start",
    });
  });

  it("provides identity-strip stats and fact rows for the redesigned profile structure", () => {
    expect(PROFILE_STATS.map((stat) => stat.label)).toEqual([
      "Active projects",
      "Connected tools",
    ]);
    expect(PROFILE_FACT_ROWS.map((row) => row.label)).toEqual([
      "Role",
      "Team",
      "Active work",
      "Private to you",
      "Visible to team",
      "Admin only",
    ]);
  });

  it("keeps the Profile shell focused on Profile infrastructure, not Workbench setup", () => {
    const source = readFileSync("components/profile/profile-shell.tsx", "utf8");

    expect(source).not.toContain("Manual connector fields");
    expect(source).not.toContain("ConnectorHub");
    expect(source).not.toContain("deriveWorkbenchPersonalisationSummary");
    expect(source).toContain("PersonalisationCard");
    expect(source).toContain("What CO OS has learned");
  });
});
