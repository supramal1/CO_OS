import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildWorkbenchConfigPayload,
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
import type { WorkbenchRunHistoryRow } from "@/lib/workbench/run-history";
import type { WorkbenchStartResponse } from "@/lib/workbench/types";

describe("Workbench UI summary", () => {
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
      statusLabel: "Not connected",
      buttonLabel: "Set up Notion",
      action: "notion_start",
      href: "/api/workbench/notion/start",
    });
    expect(affordances.googleWorkspace).toMatchObject({
      state: "not_connected",
      statusLabel: "Not connected",
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
      statusLabel: "Resource missing",
      detail: "notion_parent_page_not_found",
      buttonLabel: "Repair Notion",
      action: "notion_start",
      href: "/api/workbench/notion/start",
    });
    expect(affordances.googleWorkspace).toMatchObject({
      state: "reauth_required",
      statusLabel: "Reauth required",
      detail: "google_oauth_scope_missing",
      buttonLabel: "Repair Google Workspace",
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
      statusLabel: "Ready",
      buttonLabel: "Connected",
      disabled: true,
    });
    expect(ready.googleWorkspace).toMatchObject({
      state: "ready",
      statusLabel: "Ready",
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
      statusLabel: "Error",
      detail: "HTTP 500",
    });
    expect(unavailable.googleWorkspace).toMatchObject({
      state: "error",
      statusLabel: "Error",
      detail: "HTTP 500",
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
      statusLabel: "Repair available",
      buttonLabel: "Repair Notion",
    });
    expect(repairAvailable.googleWorkspace).toMatchObject({
      state: "repair_available",
      statusLabel: "Repair available",
      detail: "google_stored_token_missing",
      buttonLabel: "Repair Google Workspace",
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
      statusLabel: "Unavailable",
    });
    expect(unavailable.googleWorkspace).toMatchObject({
      state: "unavailable",
      statusLabel: "Unavailable",
      detail: "google_readiness unavailable",
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
      statusLabel: "Resource missing",
      detail: "drive_folder_id missing",
      buttonLabel: "Repair Google Workspace",
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
      label: "Finish setup",
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
      label: "Repair setup",
      detail: "Repair Notion and Google Workspace before running.",
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
      label: "Ready to run",
      detail: "Notion, Google auth, Calendar, and Drive are connected.",
    });
  });

  it("derives post-OAuth notices from Workbench URL params", () => {
    expect(deriveWorkbenchOAuthNotice("?google_oauth=start")).toEqual({
      tone: "info",
      label: "Starting Google OAuth",
      detail: "Opening Google Workspace consent now.",
    });
    expect(deriveWorkbenchOAuthNotice("?google_oauth=returned")).toEqual({
      tone: "info",
      label: "Google OAuth returned",
      detail: "Checking saved Google Workspace access now.",
    });
    expect(
      deriveWorkbenchOAuthNotice(
        "?notion_setup=failed&reason=notion_parent_page_not_found",
      ),
    ).toEqual({
      tone: "error",
      label: "Notion setup needs repair",
      detail: "notion_parent_page_not_found",
    });
    expect(deriveWorkbenchOAuthNotice("?error=AccessDenied")).toEqual({
      tone: "error",
      label: "OAuth returned an error",
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
        label: "Notion config",
        status: "ready",
        detail: "notion-parent-1",
      },
      {
        id: "drive",
        label: "Drive folder",
        status: "ready",
        detail: "drive-folder-1",
      },
      {
        id: "google",
        label: "Google auth/token",
        status: "ready",
        detail: "ready",
      },
      {
        id: "calendar",
        label: "Calendar readiness",
        status: "ready",
        detail: "calendar.readonly available",
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
      { label: "Notion config", status: "loading", detail: "Checking" },
      { label: "Drive folder", status: "loading", detail: "Checking" },
      { label: "Google auth/token", status: "loading", detail: "Checking" },
      { label: "Calendar readiness", status: "loading", detail: "Checking" },
    ]);

    expect(
      deriveWorkbenchConnectorSummary({
        status: "error",
        message: "HTTP 500",
      }).rows[0],
    ).toEqual({
      id: "notion",
      label: "Notion config",
      status: "error",
      detail: "HTTP 500",
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
        label: "Notion config",
        status: "unavailable",
        detail: "notion_parent_page_id missing",
      },
      {
        id: "drive",
        label: "Drive folder",
        status: "unavailable",
        detail: "drive_folder_id missing",
      },
      {
        id: "google",
        label: "Google auth/token",
        status: "unavailable",
        detail: "token_missing",
        action: "google_reconsent",
      },
      {
        id: "calendar",
        label: "Calendar readiness",
        status: "unavailable",
        detail: "google_stored_token_missing",
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
