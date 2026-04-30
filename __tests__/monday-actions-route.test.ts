import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: () => mocks.auth(),
}));

import { POST as APPROVE } from "@/app/api/monday/actions/[id]/approve/route";
import { POST as DISMISS } from "@/app/api/monday/actions/[id]/dismiss/route";
import { POST as SUGGEST_UPDATE } from "@/app/api/monday/suggest-update/route";
import { resetMondaySuggestedActionsForTests } from "@/lib/monday/suggested-actions";

function request(jsonBody: unknown = {}): NextRequest {
  return {
    json: async () => jsonBody,
  } as unknown as NextRequest;
}

function badJsonRequest(): NextRequest {
  return {
    json: async () => {
      throw new Error("bad json");
    },
  } as unknown as NextRequest;
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("monday suggested action routes", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    resetMondaySuggestedActionsForTests();
    vi.useRealTimers();
  });

  it("requires auth before creating monday update suggestions", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await SUGGEST_UPDATE(request({ source: "workbench" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("requires auth before approving monday update suggestions", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await APPROVE(request(), routeContext("msa_123"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("requires auth before dismissing monday update suggestions", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await DISMISS(request(), routeContext("msa_123"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("creates a suggested update preview from a Workbench payload", async () => {
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });

    const res = await SUGGEST_UPDATE(
      request({
        source: "workbench",
        mondayItemId: "item-123",
        event: {
          runId: "run-123",
          title: "Client X draft",
          summary: "Draft v2 is ready for review.",
          artifactUrl: "https://docs.example.com/draft",
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      action: {
        id: "msa_workbench_run-123_item-123",
        userId: "principal_123",
        source: "workbench",
        mondayItemId: "item-123",
        actionType: "post_update",
        previewText:
          "Client X draft: Draft v2 is ready for review. Link: https://docs.example.com/draft",
        payload: {
          artifactUrl: "https://docs.example.com/draft",
          runId: "run-123",
          summary: "Draft v2 is ready for review.",
          title: "Client X draft",
        },
        status: "suggested",
        createdAt: "2026-04-30T12:00:00.000Z",
        updatedAt: "2026-04-30T12:00:00.000Z",
      },
    });
  });

  it("rejects invalid suggest-update JSON", async () => {
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });

    const res = await SUGGEST_UPDATE(badJsonRequest());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("returns unavailable rather than silently posting on approval", async () => {
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    const createRes = await SUGGEST_UPDATE(
      request({
        source: "deck",
        mondayItemId: "item-456",
        event: {
          title: "Q2 deck exported",
          summary: "Deck is ready.",
          artifactUrl: "https://slides.example.com/q2",
        },
      }),
    );
    const { action } = await createRes.json();

    vi.setSystemTime(new Date("2026-04-30T12:05:00.000Z"));
    const res = await APPROVE(request(), routeContext(action.id));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "unavailable",
      reason: "monday_posting_client_not_connected",
      action: {
        id: action.id,
        status: "failed",
        previewText:
          "Q2 deck exported: Deck is ready. Link: https://slides.example.com/q2",
      },
    });
  });

  it("dismisses a suggested action deterministically", async () => {
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
    mocks.auth.mockResolvedValue({ principalId: "principal_123" });
    const createRes = await SUGGEST_UPDATE(
      request({
        source: "project",
        event: {
          title: "Project Atlas follow-up",
          summary: "Create a follow-up item.",
        },
        actionType: "create_item",
      }),
    );
    const { action } = await createRes.json();

    vi.setSystemTime(new Date("2026-04-30T12:10:00.000Z"));
    const res = await DISMISS(request(), routeContext(action.id));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "dismissed",
      action: {
        id: action.id,
        status: "dismissed",
        updatedAt: "2026-04-30T12:10:00.000Z",
      },
    });
  });
});
