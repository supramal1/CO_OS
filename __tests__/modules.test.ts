import { describe, expect, it } from "vitest";
import { MODULES } from "@/lib/modules";

describe("top-level CO OS modules", () => {
  it("keeps Admin and Agents visible for admin users", () => {
    const byId = new Map(MODULES.map((module) => [module.id, module]));

    expect(byId.get("agents")).toMatchObject({
      label: "Agents",
      path: "/agents",
      adminOnly: true,
    });
    expect(byId.get("admin")).toMatchObject({
      label: "Admin",
      path: "/admin",
      adminOnly: true,
    });
  });
});
