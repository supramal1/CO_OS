export type ModuleId =
  | "speak-to-charlie"
  | "forge"
  | "cookbook"
  | "kanban";

export type ModuleDef = {
  id: ModuleId;
  label: string;
  path: `/${ModuleId}`;
  accentVar: string;
  adminOnly?: boolean;
};

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
    id: "cookbook",
    label: "Cookbook",
    path: "/cookbook",
    accentVar: "var(--c-cookbook)",
  },
  {
    id: "kanban",
    label: "Kanban",
    path: "/kanban",
    accentVar: "var(--c-forge)",
    adminOnly: true,
  },
];

export const DEFAULT_LANDING: `/${ModuleId}` = "/speak-to-charlie";

export function moduleFromPath(pathname: string): ModuleDef | undefined {
  return MODULES.find(
    (m) => pathname === m.path || pathname.startsWith(`${m.path}/`),
  );
}
