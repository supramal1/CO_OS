import assert from "node:assert/strict";
import test from "node:test";
import { chooseForgeNamespace } from "./forge-namespace";

test("uses default when it is one of several granted workspaces", () => {
  assert.deepEqual(chooseForgeNamespace(["aiops", "default"]), {
    ok: true,
    namespace: "default",
  });
});

test("uses the only granted workspace for single-workspace invited users", () => {
  assert.deepEqual(chooseForgeNamespace(["testworkspace"]), {
    ok: true,
    namespace: "testworkspace",
  });
});

test("requested workspace must be granted", () => {
  assert.deepEqual(
    chooseForgeNamespace(["testworkspace"], "aiops"),
    { ok: false, status: 403, error: "workspace_not_granted" },
  );
});

test("falls back to the first connected workspace when default is not granted", () => {
  assert.deepEqual(chooseForgeNamespace(["client-b", "client-a"]), {
    ok: true,
    namespace: "client-a",
  });
});

test("returns a clear error when no workspaces are granted", () => {
  assert.deepEqual(chooseForgeNamespace([]), {
    ok: false,
    status: 403,
    error: "no_workspace_access",
  });
});
