import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildWorkbenchConfigPayload,
  buildWorkbenchOnboardingPayload,
  deriveWorkbenchConnectorManagementActions,
  deriveWorkbenchConnectorSummary,
  deriveWorkbenchOAuthNotice,
  deriveWorkbenchPostRunActions,
  deriveWorkbenchRunHistoryRows,
  deriveWorkbenchRunPaneSummary,
  deriveWorkbenchSetupAffordances,
  deriveWorkbenchSetupSummary,
  deriveWorkbenchUiSummary,
  getInitialWorkbenchConfigForm,
  shouldShowGoogleConnect,
  toWorkbenchStartResponseFromHistoryRun,
  toWorkbenchHealthRows,
} from "@/components/workbench/workbench-shell";
import {
  deriveWorkbenchStageRows,
  deriveWorkbenchPersonalisationSummary,
  deriveWorkbenchProfileUpdateStatus,
  toStaffWorkbenchDetail,
  toStaffWorkbenchStatusLabel,
} from "@/lib/workbench/ui-state";
import type { WorkbenchRunHistoryRow } from "@/lib/workbench/run-history";
import type { WorkbenchStartResponse } from "@/lib/workbench/types";

describe("Workbench UI summary", () => {
  it("maps setup states to staff-facing labels and sanitized details", () => {
    expect(toStaffWorkbenchStatusLabel("notion", "ready")).toBe("Connected");
    expect(toStaffWorkbenchStatusLabel("googleWorkspace", "reauth_required")).toBe(
      "Needs reconnect",
    );
    expect(toStaffWorkbenchStatusLabel("notion", "resource_missing")).toBe(
      "Repairing pages",
    );
    expect(toStaffWorkbenchStatusLabel("googleWorkspace", "resource_missing")).toBe(
      "Setting up workspace",
    );

    expect(
      toStaffWorkbenchDetail(
        "googleWorkspace",
        "reauth_required",
        "google_oauth_scope_missing",
      ),
    ).toBe("Reconnect Google Workspace");
    expect(
      toStaffWorkbenchDetail(
        "notion",
        "resource_missing",
        "notion_parent_page_not_found",
      ),
    ).toBe("Repair Workbench pages");
  });

  it("derives compact personalisation and profile-update states", () => {
    expect(
      deriveWorkbenchPersonalisationSummary({
        setupReady: false,
        config: null,
      }),
    ).toMatchObject({
      statusLabel: "Setting up workspace",
      detail: "Connect Notion and Google Workspace before personalisation.",
    });

    expect(
      deriveWorkbenchPersonalisationSummary({
        setupReady: true,
        config: {
          voice_register: "direct",
          feedback_style: "specific",
          friction_tasks: ["status reports", "deck cleanup"],
        },
      }),
    ).toMatchObject({
      statusLabel: "Connected",
      detail: "Profile basics saved.",
    });

    expect(
      deriveWorkbenchProfileUpdateStatus({
        status: "updated",
        targetLabel: "Voice",
        canUndo: true,
      }),
    ).toEqual({
      state: "updated",
      label: "Profile updated",
      detail: "Updated Voice.",
      actionLabel: "Undo last profile update",
      actionDisabled: false,
    });
  });

  it("initializes and serializes the staff setup config form", () => {
    const form = getInitialWorkbenchConfigForm({
      user_id: "principal_user_1",
      notion_parent_page_id: "notion-parent-1",
      drive_folder_id: "drive-folder-1",
      drive_folder_url: "https://drive.google.com/drive/folders/drive-folder-1",
      google_oauth_grant_status: "granted",
      google_oauth_scopes: [],
      voice_register: "direct",
      feedback_style: null,
      friction_tasks: ["status reports", "deck cleanup"],
    });

    expect(form).toEqual({
      notion_parent_page_id: "notion-parent-1",
      drive_folder_id: "drive-folder-1",
      drive_folder_url: "https://drive.google.com/drive/folders/drive-folder-1",
      voice_register: "direct",
      feedback_style: "",
      friction_tasks: "status reports\n deck cleanup",
    });

    expect(
      buildWorkbenchConfigPayload({
        ...form,
        notion_parent_page_id: " notion-parent-2 ",
        drive_folder_id: " drive-folder-2 ",
        drive_folder_url:
          " https://drive.google.com/drive/folders/drive-folder-2 ",
        friction_tasks: " status reports\n\ncopy paste, deck cleanup ",
      }),
    ).toEqual({
      notion_parent_page_id: "notion-parent-2",
      drive_folder_id: "drive-folder-2",
      drive_folder_url: "https://drive.google.com/drive/folders/drive-folder-2",
      voice_register: "direct",
      feedback_style: null,
      friction_tasks: ["status reports", "copy paste", "deck cleanup"],
    });
  });

  it("builds the compact onboarding payload for AI profile drafting", () => {
    expect(
      buildWorkbenchOnboardingPayload(
        {
          role_title: " Strategist, Client Strategy ",
          current_focus_bullets: "Nike QBR\nAI adoption",
          work_type_chips: ["Client responses", "Decks"],
          work_type_other: "stakeholder comms",
          communication_style: ["Concise", "Source-led"],
          challenge_style: ["Flag weak logic", "Suggest stronger framing"],
          helpful_context: ["Need source links"],
          helpful_context_other: "Working across multiple clients",
        },
        {
          voice_register: "concise",
          feedback_style: "specific",
          friction_tasks: "status reports, deck cleanup",
        },
      ),
    ).toEqual({
      role_title: "Strategist, Client Strategy",
      current_focus_bullets: ["Nike QBR", "AI adoption"],
      work_type_chips: ["Client responses", "Decks", "stakeholder comms"],
      communication_style: ["Concise", "Source-led"],
      challenge_style: ["Flag weak logic", "Suggest stronger framing"],
      helpful_context: ["Need source links", "Working across multiple clients"],
    });
  });

  it("shows Google connect only for readiness states that need consent or token repair", () => {
    expect(shouldShowGoogleConnect(null)).toBe(false);
    expect(shouldShowGoogleConnect({ ready: true, status: "ready" })).toBe(false);
    expect(
      shouldShowGoogleConnect({ ready: false, status: "grant_missing" }),
    ).toBe(true);
    expect(
      shouldShowGoogleConnect({ ready: false, status: "scope_missing" }),
    ).toBe(true);
    expect(
      shouldShowGoogleConnect({ ready: false, status: "token_missing" }),
    ).toBe(true);
    expect(
      shouldShowGoogleConnect({
        ready: false,
        status: "token_lookup_unavailable",
      }),
    ).toBe(true);
    expect(
      shouldShowGoogleConnect({ ready: false, status: "config_missing" }),
    ).toBe(false);
  });

  it("normalizes workbench check rows for display", () => {
    expect(
      toWorkbenchHealthRows({
        checks: [
          {
            source: "notion",
            status: "ok",
            items_count: 2,
          },
          {
            source: "calendar",
            status: "unavailable",
            reason: "Google OAuth grant missing.",
          },
        ],
        generated_at: "2026-04-29T12:00:00.000Z",
      }),
    ).toEqual([
      {
        source: "notion",
        status: "ok",
        itemsCount: 2,
        reason: null,
      },
      {
        source: "calendar",
        status: "unavailable",
        itemsCount: 0,
        reason: "Google OAuth grant missing.",
      },
    ]);
  });

  it("derives action-first setup affordances for first-run connector setup", () => {
    const affordances = deriveWorkbenchSetupAffordances({
      connectorState: {
        status: "loaded",
        config: null,
        google_readiness: {
          ready: false,
          status: "grant_missing",
          required_scopes: [],
          granted_scopes: [],
          missing_scopes: [],
          blockers: ["google_oauth_grant_missing"],
        },
      },
      healthRows: [],
    });

    expect(affordances.notion).toMatchObject({
      state: "not_connected",
      statusLabel: "Set up",
      buttonLabel: "Set up Notion",
      action: "notion_start",
      href: "/api/workbench/notion/start",
    });
    expect(affordances.googleWorkspace).toMatchObject({
      state: "not_connected",
      statusLabel: "Set up",
      buttonLabel: "Connect Google Workspace",
      action: "google_sign_in",
      callbackUrl: "/workbench?google_oauth=returned",
    });
    expect(affordances.manualConfig).toEqual({
      summaryLabel: "Manual connector fields",
      secondaryLabel: "Debug only",
      initiallyOpen: false,
    });
  });

  it("derives repair setup affordances for missing resources and Google reauth", () => {
    const affordances = deriveWorkbenchSetupAffordances({
      connectorState: {
        status: "loaded",
        config: {
          user_id: "principal_user_1",
          notion_parent_page_id: "notion-parent-1",
          drive_folder_id: "drive-folder-1",
          drive_folder_url:
            "https://drive.google.com/drive/folders/drive-folder-1",
          google_oauth_grant_status: "granted",
          google_oauth_scopes: ["https://www.googleapis.com/auth/drive.file"],
          voice_register: null,
          feedback_style: null,
          friction_tasks: null,
        },
        google_readiness: {
          ready: false,
          status: "scope_missing",
          required_scopes: [
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/calendar.readonly",
          ],
          granted_scopes: ["https://www.googleapis.com/auth/drive.file"],
          missing_scopes: [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/calendar.readonly",
          ],
          blockers: ["google_oauth_scope_missing"],
        },
      },
      healthRows: [
        {
          source: "notion",
          status: "resource_missing",
          itemsCount: 0,
          reason: "notion_parent_page_not_found",
        },
      ],
    });

    expect(affordances.notion).toMatchObject({
      state: "resource_missing",
      statusLabel: "Repairing pages",
      detail: "Repair Workbench pages",
      buttonLabel: "Repair Notion",
      action: "notion_start",
      href: "/api/workbench/notion/start",
    });
    expect(affordances.googleWorkspace).toMatchObject({
      state: "reauth_required",
      statusLabel: "Needs reconnect",
      detail: "Reconnect Google Workspace",
      buttonLabel: "Reconnect Google Workspace",
      action: "google_sign_in",
      callbackUrl: "/workbench?google_oauth=returned",
    });
  });

  it("marks setup affordances ready or unavailable", () => {
    const ready = deriveWorkbenchSetupAffordances({
      connectorState: {
        status: "loaded",
        config: {
          user_id: "principal_user_1",
          notion_parent_page_id: "notion-parent-1",
          drive_folder_id: "drive-folder-1",
          drive_folder_url:
            "https://drive.google.com/drive/folders/drive-folder-1",
          google_oauth_grant_status: "granted",
          google_oauth_scopes: [
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/calendar.readonly",
          ],
          voice_register: null,
          feedback_style: null,
          friction_tasks: null,
        },
        google_readiness: {
          ready: true,
          status: "ready",
          required_scopes: [],
          granted_scopes: [
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/calendar.readonly",
          ],
          missing_scopes: [],
          blockers: [],
        },
      },
      healthRows: [],
    });

    expect(ready.notion).toMatchObject({
      state: "ready",
      statusLabel: "Connected",
      buttonLabel: "Connected",
      disabled: true,
    });
    expect(ready.googleWorkspace).toMatchObject({
      state: "ready",
      statusLabel: "Connected",
      buttonLabel: "Connected",
      disabled: true,
    });

    const unavailable = deriveWorkbenchSetupAffordances({
      connectorState: {
        status: "error",
        message: "HTTP 500",
      },
      healthRows: [],
    });

    expect(unavailable.notion).toMatchObject({
      state: "error",
      statusLabel: "Check failed",
      detail: "Check setup",
    });
    expect(unavailable.googleWorkspace).toMatchObject({
      state: "error",
      statusLabel: "Check failed",
      detail: "Check setup",
    });
  });

  it("derives repair-available and unavailable setup states", () => {
    const repairAvailable = deriveWorkbenchSetupAffordances({
      connectorState: {
        status: "loaded",
        config: {
          user_id: "principal_user_1",
          notion_parent_page_id: "notion-parent-1",
          drive_folder_id: "drive-folder-1",
          drive_folder_url:
            "https://drive.google.com/drive/folders/drive-folder-1",
          google_oauth_grant_status: "granted",
          google_oauth_scopes: [
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/calendar.readonly",
          ],
          voice_register: null,
          feedback_style: null,
          friction_tasks: null,
        },
        google_readiness: {
          ready: false,
          status: "token_missing",
          required_scopes: [],
          granted_scopes: [],
          missing_scopes: [],
          blockers: ["google_stored_token_missing"],
        },
      },
      healthRows: [
        {
          source: "notion",
          status: "unavailable",
          itemsCount: 0,
          reason: "notion_access_unavailable",
        },
      ],
    });

    expect(repairAvailable.notion).toMatchObject({
      state: "repair_available",
      statusLabel: "Repairing pages",
      buttonLabel: "Repair Notion",
    });
    expect(repairAvailable.googleWorkspace).toMatchObject({
      state: "repair_available",
      statusLabel: "Needs reconnect",
      detail: "Reconnect Google Workspace",
      buttonLabel: "Reconnect Google Workspace",
    });

    const unavailable = deriveWorkbenchSetupAffordances({
      connectorState: {
        status: "loaded",
        config: {
          user_id: "principal_user_1",
          notion_parent_page_id: "notion-parent-1",
          drive_folder_id: "drive-folder-1",
          drive_folder_url:
            "https://drive.google.com/drive/folders/drive-folder-1",
          google_oauth_grant_status: "granted",
          google_oauth_scopes: [],
          voice_register: null,
          feedback_style: null,
          friction_tasks: null,
        },
        google_readiness: null,
      },
      healthRows: [
        {
          source: "notion",
          status: "unknown",
          itemsCount: 0,
          reason: "notion_check_unavailable",
        },
      ],
    });

    expect(unavailable.notion).toMatchObject({
      state: "unavailable",
      statusLabel: "Needs attention",
    });
    expect(unavailable.googleWorkspace).toMatchObject({
      state: "unavailable",
      statusLabel: "Needs attention",
      detail: "Check Google Workspace setup",
    });
  });

  it("requires Google Workspace and Drive before setup is ready to run", () => {
    const affordances = deriveWorkbenchSetupAffordances({
      connectorState: {
        status: "loaded",
        config: {
          user_id: "principal_user_1",
          notion_parent_page_id: "notion-parent-1",
          drive_folder_id: "",
          drive_folder_url: "",
          google_oauth_grant_status: "granted",
          google_oauth_scopes: [
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/calendar.readonly",
          ],
          voice_register: null,
          feedback_style: null,
          friction_tasks: null,
        },
        google_readiness: {
          ready: true,
          status: "ready",
          required_scopes: [],
          granted_scopes: [
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/calendar.readonly",
          ],
          missing_scopes: [],
          blockers: [],
        },
      },
      healthRows: [],
    });

    expect(affordances.googleWorkspace).toMatchObject({
      state: "resource_missing",
      statusLabel: "Setting up workspace",
      detail: "Set up Drive folder",
      buttonLabel: "Set up workspace",
    });
  });

  it("derives clear setup copy for first-run, repair, and ready states", () => {
    const firstRun = deriveWorkbenchSetupSummary(
      deriveWorkbenchSetupAffordances({
        connectorState: {
          status: "loaded",
          config: null,
          google_readiness: {
            ready: false,
            status: "grant_missing",
            required_scopes: [],
            granted_scopes: [],
            missing_scopes: [],
            blockers: ["google_oauth_grant_missing"],
          },
        },
        healthRows: [],
      }),
    );

    expect(firstRun).toEqual({
      state: "needs_setup",
      label: "Setting up workspace",
      detail: "Connect Notion and Google Workspace before running with staff context.",
    });

    const repair = deriveWorkbenchSetupSummary(
      deriveWorkbenchSetupAffordances({
        connectorState: {
          status: "loaded",
          config: {
            user_id: "principal_user_1",
            notion_parent_page_id: "notion-parent-1",
            drive_folder_id: "drive-folder-1",
            drive_folder_url:
              "https://drive.google.com/drive/folders/drive-folder-1",
            google_oauth_grant_status: "granted",
            google_oauth_scopes: ["https://www.googleapis.com/auth/drive.file"],
            voice_register: null,
            feedback_style: null,
            friction_tasks: null,
          },
          google_readiness: {
            ready: false,
            status: "scope_missing",
            required_scopes: [],
            granted_scopes: ["https://www.googleapis.com/auth/drive.file"],
            missing_scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
            blockers: ["google_oauth_scope_missing"],
          },
        },
        healthRows: [
          {
            source: "notion",
            status: "resource_missing",
            itemsCount: 0,
            reason: "notion_parent_page_not_found",
          },
        ],
      }),
    );

    expect(repair).toEqual({
      state: "repairing",
      label: "Repairing pages",
      detail: "Repair Notion and reconnect Google Workspace before running.",
    });

    const ready = deriveWorkbenchSetupSummary(
      deriveWorkbenchSetupAffordances({
        connectorState: {
          status: "loaded",
          config: {
            user_id: "principal_user_1",
            notion_parent_page_id: "notion-parent-1",
            drive_folder_id: "drive-folder-1",
            drive_folder_url:
              "https://drive.google.com/drive/folders/drive-folder-1",
            google_oauth_grant_status: "granted",
            google_oauth_scopes: [
              "https://www.googleapis.com/auth/drive.file",
              "https://www.googleapis.com/auth/spreadsheets",
              "https://www.googleapis.com/auth/calendar.readonly",
            ],
            voice_register: null,
            feedback_style: null,
            friction_tasks: null,
          },
          google_readiness: {
            ready: true,
            status: "ready",
            required_scopes: [],
            granted_scopes: [
              "https://www.googleapis.com/auth/drive.file",
              "https://www.googleapis.com/auth/spreadsheets",
              "https://www.googleapis.com/auth/calendar.readonly",
            ],
            missing_scopes: [],
            blockers: [],
          },
        },
        healthRows: [],
      }),
    );

    expect(ready).toEqual({
      state: "ready",
      label: "Connected",
      detail: "Workbench workspace is connected.",
    });
  });

  it("derives post-OAuth notices from Workbench URL params", () => {
    expect(deriveWorkbenchOAuthNotice("?google_oauth=start")).toEqual({
      tone: "info",
      label: "Connecting Google Workspace",
      detail: "Opening Google Workspace consent.",
    });
    expect(deriveWorkbenchOAuthNotice("?google_oauth=returned")).toEqual({
      tone: "info",
      label: "Google Workspace connected",
      detail: "Checking saved access.",
    });
    expect(
      deriveWorkbenchOAuthNotice(
        "?notion_setup=failed&reason=notion_parent_page_not_found",
      ),
    ).toEqual({
      tone: "error",
      label: "Notion setup needs repair",
      detail: "Repair Workbench pages",
    });
    expect(deriveWorkbenchOAuthNotice("?error=AccessDenied")).toEqual({
      tone: "error",
      label: "Connection was not completed",
      detail: "AccessDenied",
    });
    expect(deriveWorkbenchOAuthNotice("")).toBeNull();
  });

  it("derives staff-ready connector rows from config and Google readiness", () => {
    const summary = deriveWorkbenchConnectorSummary({
      status: "loaded",
      config: {
        user_id: "principal_user_1",
        notion_parent_page_id: "notion-parent-1",
        drive_folder_id: "drive-folder-1",
        drive_folder_url: "https://drive.google.com/drive/folders/drive-folder-1",
        google_oauth_grant_status: "granted",
        google_oauth_scopes: [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/calendar.readonly",
        ],
        voice_register: null,
        feedback_style: null,
        friction_tasks: null,
      },
      google_readiness: {
        ready: true,
        status: "ready",
        required_scopes: [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/calendar.readonly",
        ],
        granted_scopes: [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/calendar.readonly",
        ],
        missing_scopes: [],
        blockers: [],
      },
    });

    expect(summary.overallStatus).toBe("ready");
    expect(summary.rows).toEqual([
      {
        id: "notion",
        label: "Notion",
        status: "ready",
        detail: "Connected",
      },
      {
        id: "drive",
        label: "Drive",
        status: "ready",
        detail: "Connected",
      },
      {
        id: "google",
        label: "Google Workspace",
        status: "ready",
        detail: "Connected",
        action: undefined,
      },
      {
        id: "calendar",
        label: "Calendar",
        status: "ready",
        detail: "Connected",
        action: undefined,
      },
    ]);
  });

  it("keeps connector summary explicit for loading, error, and unavailable states", () => {
    expect(
      deriveWorkbenchConnectorSummary({ status: "loading" }).rows.map((row) => ({
        label: row.label,
        status: row.status,
        detail: row.detail,
      })),
    ).toEqual([
      { label: "Notion", status: "loading", detail: "Checking setup" },
      { label: "Drive", status: "loading", detail: "Checking setup" },
      {
        label: "Google Workspace",
        status: "loading",
        detail: "Checking setup",
      },
      { label: "Calendar", status: "loading", detail: "Checking setup" },
    ]);

    expect(
      deriveWorkbenchConnectorSummary({
        status: "error",
        message: "HTTP 500",
      }).rows[0],
    ).toEqual({
      id: "notion",
      label: "Notion",
      status: "error",
      detail: "Check setup",
    });

    const unavailable = deriveWorkbenchConnectorSummary({
      status: "loaded",
      config: null,
      google_readiness: {
        ready: false,
        status: "token_missing",
        required_scopes: [],
        granted_scopes: [],
        missing_scopes: [],
        blockers: ["google_stored_token_missing"],
      },
    });

    expect(unavailable.overallStatus).toBe("unavailable");
    expect(unavailable.rows).toEqual([
      {
        id: "notion",
        label: "Notion",
        status: "unavailable",
        detail: "Set up Notion",
      },
      {
        id: "drive",
        label: "Drive",
        status: "unavailable",
        detail: "Set up Drive folder",
      },
      {
        id: "google",
        label: "Google Workspace",
        status: "unavailable",
        detail: "Reconnect Google Workspace",
        action: "google_reconsent",
      },
      {
        id: "calendar",
        label: "Calendar",
        status: "unavailable",
        detail: "Reconnect Google Workspace",
        action: "google_reconsent",
      },
    ]);
  });

  it("derives an explicit run error pane so API failures do not look like running", () => {
    expect(
      deriveWorkbenchRunPaneSummary({
        status: "error",
        message:
          "Anthropic rejected ANTHROPIC_API_KEY. Update the local key and restart the dev server.",
      }),
    ).toEqual({
      tone: "error",
      label: "Run failed",
      title: "API error",
      detail:
        "Anthropic rejected ANTHROPIC_API_KEY. Update the local key and restart the dev server.",
    });
    expect(deriveWorkbenchRunPaneSummary({ status: "loading" })).toMatchObject({
      tone: "loading",
      label: "Running",
      title: "Workbench is running",
    });
  });

  it("uses task-run language in the visible shell", () => {
    const source = readFileSync(
      "components/workbench/workbench-shell.tsx",
      "utf8",
    );

    expect(source).toContain("Task run");
    expect(source).toContain("Task request");
    expect(source).toContain("Paste the task request and required output.");
    expect(source).toContain("Run task");
    expect(source).toContain("Ready for task");
    expect(source).toContain("Ready to run a task");
    expect(source).toContain("Recent Task Runs");
    expect(source).toContain("No task runs yet.");
    expect(source).toContain("Clarification");
    expect(source).toContain("None returned.");
    expect(source).toContain("Personalisation");
    expect(source).toContain("Role / title");
    expect(source).toContain("What sorts of things are you working on?");
    expect(source).toContain("Communication style");
    expect(source).toContain("How should Workbench challenge you?");
    expect(source).toContain("Helpful working context");
    expect(source).toContain("Preview profile");
    expect(source).toContain("Save to Notion");
    expect(source).toContain("Profile Learning");
    expect(source).toContain("Undo last profile update");
    expect(source).toContain("Understand");
    expect(source).toContain("Gather");
    expect(source).toContain("Make");
    expect(source).toContain("Review");
    expect(source).toContain("Save");
    expect(source).toContain("Generate draft");
    expect(source).toContain("Review draft");
    expect(source).not.toContain("Learn tab");
    expect(source).not.toContain("Voice fallback");
    expect(source).not.toContain("Personal context");
    expect(source).not.toContain("Tenure");

    [
      `>${["A", "sk"].join("")}<`,
      ["Paste", "a", "sk"].join(" "),
      ["Ready", "for", "a", "sk"].join(" "),
      ["Clarifying", "Message"].join(" "),
      ["No", "message."].join(" "),
      ["ch", "at"].join(""),
      ["G", "mail"].join(""),
      ["P", "OC"].join(""),
      ["de", "mo"].join(""),
      "\u2014",
    ].forEach((oldCopy) => expect(source).not.toContain(oldCopy));
  });

  it("derives operational QA state from the start response", () => {
    const response: WorkbenchStartResponse = {
      result: {
        decoded_task: {
          summary: "Prepare QBR response",
          requester: "Nike EM",
          deliverable_type: "written_response",
          task_type: "ask_decode",
        },
        missing_context: [],
        drafted_clarifying_message: "",
        retrieved_context: [
          {
            claim: "Notion brief exists",
            source_type: "notion",
            source_label: "QBR brief",
            source_url: null,
          },
          {
            claim: "Calendar hold exists",
            source_type: "calendar",
            source_label: "QBR prep",
            source_url: "https://calendar.google.com/event?eid=event-1",
          },
        ],
        suggested_approach: [],
        time_estimate: {
          estimated_before_minutes: 45,
          estimated_workbench_minutes: 20,
          task_type: "ask_decode",
        },
        warnings: ["Ask is missing final deadline."],
      },
      invocation: {
        user_id: "principal_user_1",
        invocation_type: "preflight",
        task_type: "ask_decode",
        skill_name: "workbench-preflight",
        skill_version: "0.1.0",
        estimated_before_minutes: 45,
        observed_after_minutes: null,
        latency_ms: 1234,
        ask_chars: 118,
        status: "succeeded",
        error: null,
        created_at: "2026-04-29T12:00:00.000Z",
      },
      retrieval: {
        context: [],
        statuses: [
          { source: "notion", status: "ok", items_count: 1 },
          {
            source: "calendar",
            status: "unavailable",
            reason: "Google OAuth grant missing.",
            items_count: 0,
          },
        ],
        sources: [
          {
            source: "notion",
            status: "available",
            items: [
              {
                claim: "Notion brief exists",
                source_type: "notion",
                source_label: "QBR brief",
                source_url: null,
              },
            ],
            warnings: [],
          },
          {
            source: "calendar",
            status: "unavailable",
            items: [],
            warnings: ["Google OAuth grant missing."],
          },
        ],
        warnings: ["Retrieval degraded."],
        generated_at: "2026-04-29T12:00:00.000Z",
      },
    };

    const summary = deriveWorkbenchUiSummary(response);

    expect(summary.invocationState).toBe("succeeded");
    expect(summary.sourceCount).toBe(2);
    expect(summary.hoursSavedLabel).toBe("0.4h saved");
    expect(summary.baselineLabel).toBe("45m baseline");
    expect(summary.warningCount).toBe(2);
    expect(summary.retrievalRows).toEqual([
      {
        source: "notion",
        status: "available",
        itemsCount: 1,
        reason: null,
        warnings: [],
      },
      {
        source: "calendar",
        status: "unavailable",
        itemsCount: 0,
        reason: "Google OAuth grant missing.",
        warnings: ["Google OAuth grant missing."],
      },
    ]);
  });

  it("derives visible workflow stage rows from the start response", () => {
    expect(
      deriveWorkbenchStageRows({
        current_stage: "understand",
        stages: [
          {
            id: "understand",
            label: "Understand",
            status: "complete",
            summary: "Task decoded.",
          },
          {
            id: "gather",
            label: "Gather",
            status: "complete",
            summary: "1 context item gathered.",
          },
          {
            id: "make",
            label: "Make",
            status: "available",
            summary: "Ready to generate.",
          },
          {
            id: "review",
            label: "Review",
            status: "locked",
            summary: "Generate first.",
          },
          {
            id: "save",
            label: "Save",
            status: "locked",
            summary: "Review first.",
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({ label: "Understand", state: "complete" }),
      expect.objectContaining({ label: "Gather", state: "complete" }),
      expect.objectContaining({ label: "Make", state: "available" }),
      expect.objectContaining({ label: "Review", state: "locked" }),
      expect.objectContaining({ label: "Save", state: "locked" }),
    ]);
  });

  it("derives staff-visible post-run actions from the current action contracts", () => {
    const response: WorkbenchStartResponse = {
      ...buildWorkbenchStartResponse(),
      run_history: {
        status: "stored",
        id: "run-123",
        created_at: "2026-04-29T12:00:02.000Z",
      },
    };

    expect(deriveWorkbenchPostRunActions(response)).toEqual([
      {
        id: "presend",
        label: "Prepare save-back artifact",
        detail: "Run pre-send checks and save the task output to Drive when required.",
        status: "ready",
        endpoint: "/api/workbench/presend",
        method: "POST",
        payload: {
          preflight_result: response.result,
          artifact_spec_input:
            "Prepare QBR response\nDeliverable: written_response\nTask type: ask_decode\nClarification: None returned.",
        },
      },
      {
        id: "feedback_useful",
        label: "Useful",
        detail: "Mark this Workbench run as useful.",
        status: "ready",
        endpoint: "/api/workbench/actions",
        method: "POST",
        payload: {
          action: "feedback_useful",
          run_id: "run-123",
          payload: {
            task_type: "ask_decode",
            source_count: 1,
            warning_count: 0,
          },
        },
      },
      {
        id: "feedback_not_useful",
        label: "Not useful",
        detail: "Mark this Workbench run as not useful.",
        status: "ready",
        endpoint: "/api/workbench/actions",
        method: "POST",
        payload: {
          action: "feedback_not_useful",
          run_id: "run-123",
          payload: {
            task_type: "ask_decode",
            source_count: 1,
            warning_count: 0,
          },
        },
      },
    ]);

    expect(
      deriveWorkbenchPostRunActions(response, { presendRouteAvailable: false }),
    ).toEqual([
      {
        id: "presend",
        label: "Prepare save-back artifact",
        detail: "Pre-send save-back is not available in this build.",
        status: "disabled",
        disabledReason: "presend_route_unavailable",
      },
      {
        id: "feedback_useful",
        label: "Useful",
        detail: "Mark this Workbench run as useful.",
        status: "ready",
        endpoint: "/api/workbench/actions",
        method: "POST",
        payload: {
          action: "feedback_useful",
          run_id: "run-123",
          payload: {
            task_type: "ask_decode",
            source_count: 1,
            warning_count: 0,
          },
        },
      },
      {
        id: "feedback_not_useful",
        label: "Not useful",
        detail: "Mark this Workbench run as not useful.",
        status: "ready",
        endpoint: "/api/workbench/actions",
        method: "POST",
        payload: {
          action: "feedback_not_useful",
          run_id: "run-123",
          payload: {
            task_type: "ask_decode",
            source_count: 1,
            warning_count: 0,
          },
        },
      },
    ]);
  });

  it("derives staff-readable run history rows and opens a stored run as a start response", () => {
    const response = buildWorkbenchStartResponse();
    const run: WorkbenchRunHistoryRow = {
      id: "11111111-1111-4111-8111-111111111111",
      user_id: "principal_user_1",
      ask: "  Prepare the QBR response with context from the kickoff notes and calendar.  ",
      result: {
        ...response.result,
        warnings: ["Ask is missing a final deadline."],
      },
      retrieval: {
        ...response.retrieval,
        warnings: ["Calendar returned partial context."],
      },
      invocation: response.invocation,
      created_at: "2026-04-29T12:00:02.000Z",
    };

    expect(
      deriveWorkbenchRunHistoryRows([run], {
        formatCreatedAt: () => "12:00",
        askSnippetLength: 32,
      }),
    ).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        createdLabel: "12:00",
        askSnippet: "Prepare the QBR response with...",
        status: "succeeded",
        countLabel: "2 warnings",
      },
    ]);

    expect(toWorkbenchStartResponseFromHistoryRun(run)).toEqual({
      result: run.result,
      retrieval: run.retrieval,
      invocation: run.invocation,
      run_history: {
        status: "stored",
        id: run.id,
        created_at: run.created_at,
      },
    });

    expect(
      deriveWorkbenchRunHistoryRows(
        [
          {
            ...run,
            id: "22222222-2222-4222-8222-222222222222",
            ask: "   ",
          },
        ],
        {
          formatCreatedAt: () => "12:01",
          askSnippetLength: 32,
        },
      )[0]?.askSnippet,
    ).toBe("Empty request");
  });

  it("derives connector management repair and disconnect actions from setup affordances", () => {
    const repair = deriveWorkbenchConnectorManagementActions({
      id: "googleWorkspace",
      label: "Google Workspace",
      state: "repair_available",
      statusLabel: "Repair available",
      detail: "google_stored_token_missing",
      buttonLabel: "Repair Google Workspace",
      action: "google_sign_in",
      callbackUrl: "/workbench?google_oauth=returned",
    });

    expect(repair).toEqual([
      {
        id: "google_workspace-repair",
        label: "Repair",
        source: "google_workspace",
        endpoint: "/api/workbench/connectors/google_workspace",
        method: "POST",
        payload: { action: "repair" },
      },
    ]);

    const disconnect = deriveWorkbenchConnectorManagementActions({
      id: "notion",
      label: "Notion",
      state: "ready",
      statusLabel: "Ready",
      detail: "Connected to Notion workspace",
      buttonLabel: "Connected",
      action: "notion_start",
      href: "/api/workbench/notion/start",
      disabled: true,
    });

    expect(disconnect).toEqual([
      {
        id: "notion-disconnect",
        label: "Disconnect",
        source: "notion",
        endpoint: "/api/workbench/connectors/notion",
        method: "POST",
        payload: { action: "disconnect" },
      },
    ]);
  });
});

function buildWorkbenchStartResponse(): WorkbenchStartResponse {
  return {
    result: {
      decoded_task: {
        summary: "Prepare QBR response",
        requester: "Nike EM",
        deliverable_type: "written_response",
        task_type: "ask_decode",
      },
      missing_context: [],
      drafted_clarifying_message: "",
      retrieved_context: [
        {
          claim: "Notion brief exists",
          source_type: "notion",
          source_label: "QBR brief",
          source_url: null,
        },
      ],
      suggested_approach: [],
      time_estimate: {
        estimated_before_minutes: 45,
        estimated_workbench_minutes: 20,
        task_type: "ask_decode",
      },
      warnings: [],
    },
    invocation: {
      user_id: "principal_user_1",
      invocation_type: "preflight",
      task_type: "ask_decode",
      skill_name: "workbench-preflight",
      skill_version: "0.1.0",
      estimated_before_minutes: 45,
      observed_after_minutes: null,
      latency_ms: 1234,
      ask_chars: 118,
      status: "succeeded",
      error: null,
      created_at: "2026-04-29T12:00:00.000Z",
    },
    retrieval: {
      context: [],
      statuses: [{ source: "notion", status: "ok", items_count: 1 }],
      sources: [
        {
          source: "notion",
          status: "available",
          items: [
            {
              claim: "Notion brief exists",
              source_type: "notion",
              source_label: "QBR brief",
              source_url: null,
            },
          ],
          warnings: [],
        },
      ],
      warnings: [],
      generated_at: "2026-04-29T12:00:00.000Z",
    },
  };
}
