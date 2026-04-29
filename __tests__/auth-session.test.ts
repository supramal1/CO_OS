import { describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { buildClientSession } from "@/lib/auth-session";

describe("Auth session shape", () => {
  it("does not expose the per-principal API key on the client session", () => {
    const session = buildClientSession(
      {
        user: {
          email: "staff@example.com",
          name: "Staff User",
        },
        expires: "2026-05-29T00:00:00.000Z",
      } as Session,
      {
        principalId: "principal_staff",
        principalName: "Staff User",
        apiKey: "csk_secret",
        isAdmin: true,
      } as JWT,
    );

    expect(session.principalId).toBe("principal_staff");
    expect(session.isAdmin).toBe(true);
    expect("apiKey" in session).toBe(false);
  });
});
