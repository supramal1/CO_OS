import assert from "node:assert/strict";
import test from "node:test";
import {
  canSignInEmail,
  hasPendingInvitationForEmail,
  parseAllowedEmails,
} from "./auth-access";

test("pending invitation admits an external email", async () => {
  const allowed = await canSignInEmail({
    email: "Malik.Roberts@wppmedia.com",
    allowedEmails: [],
    hasPendingInvitation: async (email) =>
      email === "malik.roberts@wppmedia.com",
  });

  assert.equal(allowed, true);
});

test("external email without invitation or allowlist is rejected", async () => {
  const allowed = await canSignInEmail({
    email: "person@example.com",
    allowedEmails: [],
    hasPendingInvitation: async () => false,
  });

  assert.equal(allowed, false);
});

test("charlie oscar domain and explicit allowlist still pass without invitation", async () => {
  assert.equal(
    await canSignInEmail({
      email: "person@charlieoscar.com",
      allowedEmails: [],
      hasPendingInvitation: async () => false,
    }),
    true,
  );
  assert.equal(
    await canSignInEmail({
      email: "External@Example.com",
      allowedEmails: ["external@example.com"],
      hasPendingInvitation: async () => false,
    }),
    true,
  );
});

test("pending invitation match is case-insensitive and status-aware", () => {
  assert.equal(
    hasPendingInvitationForEmail(
      [
        { email: "malik.roberts@wppmedia.com", status: "claimed" },
        { email: "MALIK.ROBERTS@WPPMEDIA.COM", status: "pending" },
      ],
      "malik.roberts@wppmedia.com",
    ),
    true,
  );
});

test("allowed email config is normalized", () => {
  assert.deepEqual(
    parseAllowedEmails(" A@example.com, ,b@example.com "),
    ["a@example.com", "b@example.com"],
  );
});
