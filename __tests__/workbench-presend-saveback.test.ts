import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchArtifact } from "@/lib/workbench/save-back";

const mocks = vi.hoisted(() => ({
  loadWorkbenchSkill: vi.fn(),
  anthropicCreate: vi.fn(),
  persistWorkbenchInvocation: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/workbench/skill-loader", () => ({
  loadWorkbenchSkill: (...args: unknown[]) => mocks.loadWorkbenchSkill(...args),
}));

vi.mock("@/lib/workbench/persistence", () => ({
  persistWorkbenchInvocation: (...args: unknown[]) =>
    mocks.persistWorkbenchInvocation(...args),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = {
      create: (...args: unknown[]) => mocks.anthropicCreate(...args),
    };
  },
}));

import { runWorkbenchPresend } from "@/lib/workbench/presend-start";

const preflightResult = {
  decoded_task: {
    summary: "Prepare a client-ready follow-up note",
    requester: "EM",
    deliverable_type: "written_response",
    task_type: "draft_check",
  },
  missing_context: [],
  drafted_clarifying_message: "",
  retrieved_context: [],
  suggested_approach: [],
  time_estimate: {
    estimated_before_minutes: 35,
    estimated_workbench_minutes: 12,
    task_type: "draft_check",
  },
  warnings: [],
};

const presendModelResult = {
  artifact_intent: {
    artifact_type: "docx_scaffold",
    title: "Client Follow Up",
    audience: "Client team",
    purpose: "Confirm decisions and next steps",
  },
  artifact_spec: {
    format: "json_note",
    sections: [
      {
        heading: "Decisions",
        purpose: "Capture what was agreed",
      },
      {
        heading: "Next steps",
        purpose: null,
      },
    ],
    source_context: [
      {
        claim: "QBR decision owner is Morgan.",
        source_type: "notion",
        source_label: "QBR notes",
        source_url: "https://notion.test/qbr-notes",
      },
    ],
  },
  quality_checks: [
    {
      check: "No unsupported claims",
      status: "pass",
      detail: null,
    },
    {
      check: "Client names verified",
      status: "warn",
      detail: "Confirm spelling before sending.",
    },
  ],
  save_back_requirements: [
    {
      target: "drive",
      action: "save_artifact",
      required: true,
      reason: "Save the scaffold to Drive",
    },
  ],
  warnings: ["Add final send deadline before sharing."],
};

beforeEach(() => {
  mocks.loadWorkbenchSkill.mockReset();
  mocks.anthropicCreate.mockReset();
  mocks.persistWorkbenchInvocation.mockReset();
  mocks.loadWorkbenchSkill.mockResolvedValue({
    name: "workbench-presend",
    version: "0.1.0",
    content: "PRESEND SYSTEM PROMPT",
  });
  mocks.anthropicCreate.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(presendModelResult) }],
  });
  mocks.persistWorkbenchInvocation.mockResolvedValue(undefined);
});

describe("Workbench presend Drive save-back", () => {
  it("saves a deterministic readable presend Markdown artifact to the configured Drive folder", async () => {
    const uploads: Array<{ artifact: WorkbenchArtifact; folderId: string }> = [];

    const response = await runWorkbenchPresend({
      preflightResult,
      draftInput: "Draft: Thanks for the time today.",
      artifactSpecInput: "Need a client follow-up artifact.",
      reviewedArtifact: {
        artifact_type: "client_email",
        title: "Client delay update",
        review_status: "approved_with_checks",
        source_count: 2,
        destination: "drive",
      },
      userId: "principal_user_1",
      apiKey: "csk_test",
      anthropicApiKey: "anthropic-test",
      getUserConfig: async () => ({
        user_id: "principal_user_1",
        notion_parent_page_id: "notion-parent",
        drive_folder_id: "drive-folder-1",
        drive_folder_url: "https://drive.google.com/drive-folder-1",
        google_oauth_grant_status: "granted",
        google_oauth_scopes: [],
        voice_register: null,
        feedback_style: null,
        friction_tasks: null,
      }),
      googleAccessTokenProvider: async () => ({
        status: "available",
        accessToken: "google-access-token",
      }),
      createDriveUploader: ({ accessToken, driveFolderId }) => {
        expect(accessToken).toBe("google-access-token");
        expect(driveFolderId).toBe("drive-folder-1");
        return {
          status: "available",
          folderId: "drive-folder-1",
          uploader: async (input) => {
            uploads.push(input);
            return {
              fileId: "drive-file-1",
              webUrl: "https://drive.google.com/file/d/drive-file-1/view",
            };
          },
        };
      },
    });

    expect(response.save_back).toEqual({
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
      artifact: {
        artifact_type: "client_email",
        title: "Client delay update",
        review_status: "approved_with_checks",
        source_count: 2,
        destination: "drive",
      },
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.folderId).toBe("drive-folder-1");
    expect(uploads[0]?.artifact).toMatchObject({
      id: "presend-client-follow-up",
      name: "client-follow-up-presend.md",
      mimeType: "text/markdown",
      metadata: {
        artifactType: "docx_scaffold",
        format: "json_note",
        target: "drive",
      },
    });
    expect(uploads[0]?.artifact.content).toBe(`# Client Follow Up

## Purpose
Confirm decisions and next steps

## Audience
Client team

## Format
json_note

## Sections
- Decisions: Capture what was agreed
- Next steps

## Source Context
- [notion] QBR notes: QBR decision owner is Morgan. (https://notion.test/qbr-notes)

## Quality Checks
- pass: No unsupported claims
- warn: Client names verified - Confirm spelling before sending.

## Warnings
- Add final send deadline before sharing.
`);
    expect(mocks.persistWorkbenchInvocation).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable save-back when the Google access token is missing", async () => {
    const response = await runWorkbenchPresend({
      preflightResult,
      draftInput: "Draft: Thanks for the time today.",
      userId: "principal_user_1",
      apiKey: "csk_test",
      anthropicApiKey: "anthropic-test",
      getUserConfig: async () => ({
        user_id: "principal_user_1",
        notion_parent_page_id: "notion-parent",
        drive_folder_id: "drive-folder-1",
        drive_folder_url: "https://drive.google.com/drive-folder-1",
        google_oauth_grant_status: "granted",
        google_oauth_scopes: [],
        voice_register: null,
        feedback_style: null,
        friction_tasks: null,
      }),
      googleAccessTokenProvider: async () => ({
        status: "unavailable",
        reason: "google_refresh_token_missing",
      }),
    });

    expect(response.save_back).toEqual({
      status: "unavailable",
      target: "drive",
      reason: "google_refresh_token_missing",
    });
    expect(mocks.persistWorkbenchInvocation).toHaveBeenCalledTimes(1);
  });

  it("returns error save-back when Drive upload throws without failing presend logging", async () => {
    const response = await runWorkbenchPresend({
      preflightResult,
      draftInput: "Draft: Thanks for the time today.",
      userId: "principal_user_1",
      apiKey: "csk_test",
      anthropicApiKey: "anthropic-test",
      getUserConfig: async () => ({
        user_id: "principal_user_1",
        notion_parent_page_id: "notion-parent",
        drive_folder_id: "drive-folder-1",
        drive_folder_url: "https://drive.google.com/drive-folder-1",
        google_oauth_grant_status: "granted",
        google_oauth_scopes: [],
        voice_register: null,
        feedback_style: null,
        friction_tasks: null,
      }),
      googleAccessTokenProvider: async () => ({
        status: "available",
        accessToken: "google-access-token",
      }),
      createDriveUploader: () => ({
        status: "available",
        folderId: "drive-folder-1",
        uploader: async () => {
          throw new Error("Drive upload exploded");
        },
      }),
    });

    expect(response.save_back).toEqual({
      status: "error",
      target: "drive",
      reason: "drive_upload_failed",
      message: "Drive upload exploded",
    });
    expect(mocks.persistWorkbenchInvocation).toHaveBeenCalledTimes(1);
  });
});
