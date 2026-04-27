import assert from "node:assert/strict";
import test from "node:test";
import { addAndSelectWorkspace } from "./workspace-state";

test("new workspace is added and selected when server workspace list is stale", () => {
  const next = addAndSelectWorkspace(["default", "aiops"], "client-acme");

  assert.deepEqual(next.workspaces, ["aiops", "client-acme", "default"]);
  assert.equal(next.selectedWorkspace, "client-acme");
});

test("blank workspace names are ignored", () => {
  const next = addAndSelectWorkspace(["default"], "   ");

  assert.deepEqual(next.workspaces, ["default"]);
  assert.equal(next.selectedWorkspace, "default");
});
