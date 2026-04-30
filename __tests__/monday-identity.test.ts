import { describe, expect, it } from "vitest";
import {
  confirmMondayIdentity,
  resolveMondayIdentity,
} from "@/lib/monday/identity";

describe("monday identity resolution", () => {
  it("returns a clean unavailable state before monday OAuth is configured", () => {
    expect(
      resolveMondayIdentity({
        userId: "principal_123",
        email: "malik@example.com",
        env: {},
      }),
    ).toEqual({
      source: "monday",
      status: "not_configured",
      configured: false,
      identity: null,
      message: "monday connector is not configured yet.",
    });
  });

  it("resolves exact email matches as high confidence without confirmation", () => {
    expect(
      resolveMondayIdentity({
        userId: "principal_123",
        email: "malik@example.com",
        env: {
          MONDAY_CLIENT_ID: "client-id",
          MONDAY_CLIENT_SECRET: "client-secret",
        },
        candidate: {
          mondayUserId: "monday-user-1",
          mondayAccountId: "monday-account-1",
          name: "Malik James-Williams",
          email: "Malik@Example.com",
        },
      }),
    ).toEqual({
      source: "monday",
      status: "resolved",
      configured: true,
      identity: {
        mondayUserId: "monday-user-1",
        mondayAccountId: "monday-account-1",
        name: "Malik James-Williams",
        email: "Malik@Example.com",
        confidence: "high",
        confirmationRequired: false,
      },
      message: "monday identity resolved from the signed-in email.",
    });
  });

  it("requires confirmation when the monday email does not exactly match the signed-in user", () => {
    expect(
      resolveMondayIdentity({
        userId: "principal_123",
        email: "malik@example.com",
        env: {
          MONDAY_CLIENT_ID: "client-id",
          MONDAY_CLIENT_SECRET: "client-secret",
        },
        candidate: {
          mondayUserId: "monday-user-2",
          mondayAccountId: "monday-account-1",
          name: "MJW",
          email: "ops@example.com",
        },
      }),
    ).toMatchObject({
      source: "monday",
      status: "confirmation_required",
      configured: true,
      identity: {
        mondayUserId: "monday-user-2",
        mondayAccountId: "monday-account-1",
        email: "ops@example.com",
        confidence: "low",
        confirmationRequired: true,
      },
    });
  });

  it("rejects invalid confirmation payloads before persistence", async () => {
    await expect(
      confirmMondayIdentity({
        userId: "principal_123",
        payload: {
          mondayUserId: "",
          mondayAccountId: "monday-account-1",
        },
      }),
    ).resolves.toEqual({
      accepted: false,
      status: "invalid",
      message: "mondayUserId and mondayAccountId are required.",
      identity: null,
    });
  });

  it("returns unavailable until the persistence hook is wired", async () => {
    await expect(
      confirmMondayIdentity({
        userId: "principal_123",
        payload: {
          mondayUserId: "monday-user-1",
          mondayAccountId: "monday-account-1",
          name: "Malik James-Williams",
          email: "malik@example.com",
        },
      }),
    ).resolves.toMatchObject({
      accepted: false,
      status: "unavailable",
      identity: {
        mondayUserId: "monday-user-1",
        mondayAccountId: "monday-account-1",
        confidence: "high",
        confirmationRequired: false,
      },
    });
  });
});
