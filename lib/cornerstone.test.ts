import assert from "node:assert/strict";
import test from "node:test";
import { workspaceNamesForAdminInvites } from "./cornerstone";

test("invite workspace list keeps only active admin grants", () => {
  const names = workspaceNamesForAdminInvites([
    { name: "workspace-a", access_level: "admin", status: "active" },
    { name: "workspace-b", access_level: "write", status: "active" },
    { name: "workspace-c", access_level: "read", status: "active" },
    { name: "workspace-d", access_level: "admin", status: "archived" },
  ]);

  assert.deepEqual(names, ["workspace-a"]);
});
