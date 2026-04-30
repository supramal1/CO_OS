import { describe, expect, it } from "vitest";
import { MODULES, NAV_ITEMS } from "@/lib/modules";

describe("top-level CO OS modules", () => {
  it("keeps admin-only operational modules visible for admin users", () => {
    const byId = new Map(MODULES.map((module) => [module.id, module]));
    const ids = MODULES.map((module): string => module.id);

    expect(ids).not.toContain("agents");
    expect(byId.get("workforce")).toMatchObject({
      label: "Workforce",
      path: "/workforce",
      adminOnly: true,
    });
    expect(byId.get("workbench")).toMatchObject({
      label: "Workbench",
      path: "/workbench",
    });
    expect(ids).not.toContain("profile");
    expect(byId.get("admin")).toMatchObject({
      label: "Admin",
      path: "/admin",
      adminOnly: true,
    });
  });

  it("keeps Workbench out of Dispatch under its own nav heading", () => {
    expect(NAV_ITEMS).toEqual([
      {
        type: "group",
        id: "dispatch",
        label: "Dispatch",
        children: ["speak-to-charlie", "forge", "workforce"],
        accentVar: "var(--c-forge)",
      },
      {
        type: "group",
        id: "work",
        label: "Workbench",
        children: ["workbench"],
        accentVar: "var(--c-cowork)",
      },
      { type: "module", id: "cookbook" },
      { type: "module", id: "admin" },
    ]);
  });
});
