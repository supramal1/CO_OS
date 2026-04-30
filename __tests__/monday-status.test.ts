import { describe, expect, it } from "vitest";
import { getMondayConnectionStatus } from "@/lib/monday/status";

describe("monday connection status", () => {
  it("does not pretend monday is connected before OAuth is configured", () => {
    expect(
      getMondayConnectionStatus({
        userId: "principal_123",
        env: {},
      }),
    ).toEqual({
      source: "monday",
      state: "not_configured",
      connected: false,
      configured: false,
      message: "monday connector is not configured yet.",
      actionLabel: "Set up",
      nextUrl: "/profile",
    });
  });

  it("reports monday as ready to connect once OAuth config exists", () => {
    expect(
      getMondayConnectionStatus({
        userId: "principal_123",
        env: {
          MONDAY_CLIENT_ID: "client-id",
          MONDAY_CLIENT_SECRET: "client-secret",
        },
      }),
    ).toMatchObject({
      source: "monday",
      state: "disconnected",
      connected: false,
      configured: true,
      actionLabel: "Connect",
    });
  });
});
