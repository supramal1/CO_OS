import { describe, expect, it } from "vitest";
import { MODULES } from "@/lib/modules";

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
    expect(byId.get("admin")).toMatchObject({
      label: "Admin",
      path: "/admin",
      adminOnly: true,
    });
  });
});
