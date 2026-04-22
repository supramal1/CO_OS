export type ModuleId = "cookbook" | "cornerstone" | "forge";

export type ModuleDef = {
  id: ModuleId;
  label: string;
  path: `/${ModuleId}`;
  accentVar: string;
};

export const MODULES: ModuleDef[] = [
  { id: "cookbook",    label: "Cookbook",    path: "/cookbook",    accentVar: "var(--c-cookbook)" },
  { id: "cornerstone", label: "Cornerstone", path: "/cornerstone", accentVar: "var(--c-cornerstone)" },
  { id: "forge",       label: "Forge",       path: "/forge",       accentVar: "var(--c-forge)" },
];

export function moduleFromPath(pathname: string): ModuleDef | undefined {
  return MODULES.find((m) => pathname === m.path || pathname.startsWith(`${m.path}/`));
}
