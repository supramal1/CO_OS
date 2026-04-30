export type ModuleId =
  | "speak-to-charlie"
  | "forge"
  | "workbench"
  | "cookbook"
  | "workforce"
  | "admin";

export type ModuleDef = {
  id: ModuleId;
  label: string;
  path: `/${ModuleId}`;
  accentVar: string;
  adminOnly?: boolean;
};

export type ModuleGroupDef = {
  type: "group";
  id: "dispatch" | "work";
  label: string;
  children: ModuleId[];
  accentVar: string;
};

export type ModuleNavItem =
  | { type: "module"; id: ModuleId }
  | ModuleGroupDef;

// Order here is the tab-nav order, left to right.
export const MODULES: ModuleDef[] = [
  {
    id: "speak-to-charlie",
    label: "Speak to Charlie",
    path: "/speak-to-charlie",
    accentVar: "var(--c-cornerstone)",
  },
  {
    id: "forge",
    label: "Forge",
    path: "/forge",
    accentVar: "var(--c-forge)",
  },
  {
    id: "workbench",
    label: "Workbench",
    path: "/workbench",
    accentVar: "var(--c-cowork)",
  },
  {
    id: "cookbook",
    label: "Cookbook",
    path: "/cookbook",
    accentVar: "var(--c-cookbook)",
  },
  {
    id: "workforce",
    label: "Workforce",
    path: "/workforce",
    accentVar: "var(--c-forge)",
    adminOnly: true,
  },
  {
    id: "admin",
    label: "Admin",
    path: "/admin",
    accentVar: "var(--c-admin)",
    adminOnly: true,
  },
];

export const NAV_ITEMS: ModuleNavItem[] = [
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
];

export const DEFAULT_LANDING: `/${ModuleId}` = "/speak-to-charlie";

export function moduleById(id: ModuleId): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}

export function moduleFromPath(pathname: string): ModuleDef | undefined {
  return MODULES.find(
    (m) => pathname === m.path || pathname.startsWith(`${m.path}/`),
  );
}
