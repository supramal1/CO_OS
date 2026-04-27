import assert from "node:assert/strict";
import test from "node:test";
import {
  filterGrantablePrincipals,
  workspaceGrantSuccessMessage,
} from "./grant-access-state";
import type { Principal } from "../../lib/admin-types";

function principal(
  id: string,
  status: Principal["status"],
  name = id,
): Principal {
  return {
    id,
    name,
    email: null,
    type: "human",
    status,
    created_at: "2026-04-29T00:00:00Z",
  };
}

test("grantable principals are active users that are not already workspace members", () => {
  const existingMemberIds = new Set(["already-member"]);

  const grantable = filterGrantablePrincipals(
    [
      principal("available", "active", "Available User"),
      principal("already-member", "active", "Existing Member"),
      principal("suspended", "suspended", "Suspended User"),
      principal("archived", "archived", "Archived User"),
      principal("deleted", "deleted", "Deleted User"),
    ],
    existingMemberIds,
  );

  assert.deepEqual(
    grantable.map((p) => p.id),
    ["available"],
  );
});

test("grant success message names the workspace", () => {
  assert.equal(
    workspaceGrantSuccessMessage("AI Ops"),
    "Granted access to AI Ops.",
  );
});
