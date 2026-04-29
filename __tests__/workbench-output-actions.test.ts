import { describe, expect, it } from "vitest";
import type { WorkbenchStartResponse } from "@/lib/workbench/types";
import {
  deriveWorkbenchOutputActions,
  WORKBENCH_OUTPUT_ACTIONS,
} from "@/lib/workbench/output-actions";

const startResponse: WorkbenchStartResponse = {
  result: {
    decoded_task: {
      summary: "Prepare the client follow-up",
      requester: "Ops",
      deliverable_type: "written_response",
      task_type: "draft_check",
    },
    missing_context: [],
    drafted_clarifying_message: "",
    retrieved_context: [],
    suggested_approach: [],
    time_estimate: {
      estimated_before_minutes: 30,
      estimated_workbench_minutes: 12,
      task_type: "draft_check",
    },
    warnings: [],
  },
  invocation: {
    user_id: "principal_123",
    invocation_type: "preflight",
    task_type: "draft_check",
    skill_name: "workbench-preflight",
    skill_version: "0.1.0",
    estimated_before_minutes: 30,
    observed_after_minutes: null,
    latency_ms: 1200,
    ask_chars: 31,
    status: "succeeded",
    error: null,
    created_at: "2026-04-29T12:00:00.000Z",
  },
  retrieval: {
    context: [],
    statuses: [],
    generated_at: "2026-04-29T12:00:00.000Z",
  },
};

describe("Workbench output action contracts", () => {
  it("defines the V1 post-run action set without Gmail actions", () => {
    expect(WORKBENCH_OUTPUT_ACTIONS).toEqual([
      "copy_response",
      "save_to_drive",
      "save_to_notion",
      "feedback_useful",
      "feedback_not_useful",
    ]);
    expect(WORKBENCH_OUTPUT_ACTIONS.join(" ")).not.toMatch(/gmail/i);
  });

  it("derives deterministic staff-visible actions from a run and ready connectors", () => {
    const actions = deriveWorkbenchOutputActions({
      startResponse,
      connector: {
        config: {
          drive_folder_id: "drive-folder-1",
          notion_parent_page_id: "notion-parent-1",
        },
        google_readiness: {
          ready: true,
          status: "ready",
          blockers: [],
          missing_scopes: [],
        },
        checks: [
          { source: "drive", status: "ready" },
          { source: "notion", status: "ready" },
          { source: "google", status: "ready" },
        ],
      },
    });

    expect(actions.map((action) => action.action)).toEqual(
      WORKBENCH_OUTPUT_ACTIONS,
    );
    expect(actions).toContainEqual(
      expect.objectContaining({
        action: "copy_response",
        mode: "client",
        availability: "available",
        reason: "client_side_action",
      }),
    );
    expect(actions).toContainEqual(
      expect.objectContaining({
        action: "save_to_drive",
        mode: "server",
        target: "drive",
        availability: "available",
        reason: "drive_ready",
      }),
    );
    expect(actions).toContainEqual(
      expect.objectContaining({
        action: "save_to_notion",
        mode: "server",
        target: "notion",
        availability: "unavailable",
        reason: "notion_save_back_not_supported_v1",
      }),
    );
    expect(actions).toContainEqual(
      expect.objectContaining({
        action: "feedback_useful",
        mode: "server",
        target: "feedback",
        availability: "available",
        reason: "feedback_available",
      }),
    );
    expect(actions).toContainEqual(
      expect.objectContaining({
        action: "feedback_not_useful",
        mode: "server",
        target: "feedback",
        availability: "available",
        reason: "feedback_available",
      }),
    );
  });

  it("surfaces Drive blockers from connector checks and keeps Notion unsupported", () => {
    const actions = deriveWorkbenchOutputActions({
      startResponse,
      connector: {
        config: {
          drive_folder_id: "drive-folder-1",
          notion_parent_page_id: "notion-parent-1",
        },
        google_readiness: {
          ready: false,
          status: "scope_missing",
          blockers: ["google_drive_scope_missing"],
          missing_scopes: ["https://www.googleapis.com/auth/drive.file"],
        },
        checks: [
          {
            source: "drive",
            status: "reauth_required",
            reason: "google_reauth_required",
            action: "google_reconsent",
          },
        ],
      },
    });

    expect(actions.find((action) => action.action === "save_to_drive")).toEqual(
      expect.objectContaining({
        availability: "unavailable",
        reason: "google_reauth_required",
        action_hint: "google_reconsent",
      }),
    );
    expect(actions.find((action) => action.action === "save_to_notion")).toEqual(
      expect.objectContaining({
        availability: "unavailable",
        reason: "notion_save_back_not_supported_v1",
      }),
    );
  });

  it("prefers presend save-back status when supplied", () => {
    const actions = deriveWorkbenchOutputActions({
      startResponse,
      connector: {
        config: {
          drive_folder_id: "drive-folder-1",
          notion_parent_page_id: "notion-parent-1",
        },
        google_readiness: {
          ready: true,
          status: "ready",
          blockers: [],
          missing_scopes: [],
        },
      },
      saveBack: {
        status: "saved",
        target: "drive",
        source: {
          provider: "google_drive",
          status: "available",
          fileId: "drive-file-1",
          folderId: "drive-folder-1",
          name: "client-follow-up-presend.md",
          mimeType: "text/markdown",
          webUrl: "https://drive.google.com/file/d/drive-file-1/view",
        },
      },
    });

    expect(actions.find((action) => action.action === "save_to_drive")).toEqual(
      expect.objectContaining({
        availability: "available",
        reason: "drive_save_back_saved",
        save_back: expect.objectContaining({
          status: "saved",
          target: "drive",
        }),
      }),
    );
  });

  it("disables response copy and Drive save actions when the run failed", () => {
    const failedStartResponse: WorkbenchStartResponse = {
      ...startResponse,
      invocation: {
        ...startResponse.invocation,
        status: "failed",
        error: "model_timeout",
      },
    };

    const actions = deriveWorkbenchOutputActions({
      startResponse: failedStartResponse,
      connector: {
        config: {
          drive_folder_id: "drive-folder-1",
          notion_parent_page_id: "notion-parent-1",
        },
        google_readiness: {
          ready: true,
          status: "ready",
          blockers: [],
          missing_scopes: [],
        },
        checks: [{ source: "drive", status: "ready" }],
      },
    });

    expect(actions.find((action) => action.action === "copy_response")).toEqual(
      expect.objectContaining({
        availability: "unavailable",
        reason: "run_failed",
      }),
    );
    expect(actions.find((action) => action.action === "save_to_drive")).toEqual(
      expect.objectContaining({
        availability: "unavailable",
        reason: "run_failed",
      }),
    );
    expect(actions.find((action) => action.action === "feedback_not_useful")).toEqual(
      expect.objectContaining({
        availability: "available",
        reason: "feedback_available",
      }),
    );
  });
});
