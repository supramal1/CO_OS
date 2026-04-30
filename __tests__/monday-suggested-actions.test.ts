import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveMondaySuggestedAction,
  createMondaySuggestedAction,
  dismissMondaySuggestedAction,
  resetMondaySuggestedActionsForTests,
} from "@/lib/monday/suggested-actions";

describe("monday suggested actions", () => {
  beforeEach(() => {
    resetMondaySuggestedActionsForTests();
  });

  it("creates a deterministic Workbench update preview without posting", () => {
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));

    const action = createMondaySuggestedAction({
      userId: "principal_123",
      source: "workbench",
      mondayItemId: "item-123",
      event: {
        runId: "run-123",
        title: "Client X draft",
        summary:
          "Draft v2 is ready for review. Main open question is whether to lead with Route B.",
        artifactUrl: "https://docs.example.com/draft-v2",
      },
    });

    expect(action).toEqual({
      id: "msa_workbench_run-123_item-123",
      userId: "principal_123",
      source: "workbench",
      mondayItemId: "item-123",
      actionType: "post_update",
      previewText:
        "Client X draft: Draft v2 is ready for review. Main open question is whether to lead with Route B. Link: https://docs.example.com/draft-v2",
      payload: {
        artifactUrl: "https://docs.example.com/draft-v2",
        runId: "run-123",
        summary:
          "Draft v2 is ready for review. Main open question is whether to lead with Route B.",
        title: "Client X draft",
      },
      status: "suggested",
      createdAt: "2026-04-30T12:00:00.000Z",
      updatedAt: "2026-04-30T12:00:00.000Z",
    });
  });

  it("returns unavailable on approval when no posting client exists", () => {
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
    const action = createMondaySuggestedAction({
      userId: "principal_123",
      source: "deck",
      mondayItemId: "item-456",
      event: {
        title: "Q2 deck exported",
        summary: "Slides are ready for client review.",
        artifactUrl: "https://slides.example.com/q2",
      },
    });

    vi.setSystemTime(new Date("2026-04-30T12:05:00.000Z"));
    const result = approveMondaySuggestedAction({
      userId: "principal_123",
      actionId: action.id,
    });

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") {
      throw new Error("expected monday approval to be unavailable");
    }
    expect(result.reason).toBe("monday_posting_client_not_connected");
    expect(result.action).toMatchObject({
      id: action.id,
      status: "failed",
      previewText:
        "Q2 deck exported: Slides are ready for client review. Link: https://slides.example.com/q2",
      payload: {
        artifactUrl: "https://slides.example.com/q2",
        summary: "Slides are ready for client review.",
        title: "Q2 deck exported",
      },
      updatedAt: "2026-04-30T12:05:00.000Z",
    });
  });

  it("dismisses only the current user's suggested action", () => {
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
    const action = createMondaySuggestedAction({
      userId: "principal_123",
      source: "project",
      event: {
        title: "Project Atlas follow-up",
        summary: "Create a lightweight check-in item.",
      },
      actionType: "create_item",
    });

    vi.setSystemTime(new Date("2026-04-30T12:10:00.000Z"));

    expect(
      dismissMondaySuggestedAction({
        userId: "other_user",
        actionId: action.id,
      }),
    ).toEqual({ status: "not_found", action: null });

    expect(
      dismissMondaySuggestedAction({
        userId: "principal_123",
        actionId: action.id,
      }),
    ).toMatchObject({
      status: "dismissed",
      action: {
        id: action.id,
        status: "dismissed",
        updatedAt: "2026-04-30T12:10:00.000Z",
      },
    });
  });
});
