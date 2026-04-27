import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvitationRequest,
  initialInviteWorkspaceSelection,
  isRoleInvitableFromAdminPanel,
} from "./invite-state";

test("invite defaults to the selected workspace when it is connected", () => {
  const selected = initialInviteWorkspaceSelection(
    ["default", "aiops"],
    "aiops",
  );

  assert.deepEqual(Array.from(selected), ["aiops"]);
});

test("invite falls back to the first connected workspace", () => {
  const selected = initialInviteWorkspaceSelection(
    ["default", "aiops"],
    "missing",
  );

  assert.deepEqual(Array.from(selected), ["default"]);
});

test("invitation request is role-template driven", () => {
  const payload = buildInvitationRequest({
    email: " New.User@Example.COM ",
    role: "workspace_admin",
    namespaces: ["aiops"],
    notes: " ",
    pronouns: "they/them",
    jobTitle: "",
    organization: "",
    teams: "core, product",
  });

  assert.deepEqual(payload, {
    email: "new.user@example.com",
    role_template: "workspace_admin",
    namespaces: ["aiops"],
    notes: null,
    pronouns: "they/them",
    job_title: "",
    organization: "Charlie Oscar",
    team_slugs: ["core", "product"],
  });
  assert.equal("is_co_os_admin" in payload, false);
});

test("super admin is not invitable from the workspace admin panel", () => {
  assert.equal(isRoleInvitableFromAdminPanel("staff"), true);
  assert.equal(isRoleInvitableFromAdminPanel("workspace_admin"), true);
  assert.equal(isRoleInvitableFromAdminPanel("viewer"), true);
  assert.equal(isRoleInvitableFromAdminPanel("super_admin"), false);
});
