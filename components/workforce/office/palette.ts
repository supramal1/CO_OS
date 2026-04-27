// Pixel office palette. Hex restated from the global oklch tokens so the
// SVG renders identically when SSR'd outside a CSS context. Anything
// keyed by a tool surface (Cornerstone / Cookbook / etc.) lives in
// KIND_COLORS so a station's colour is a function of its kind, not its
// label — meaning a team can ship a "Vault" station (kind=monolith) and
// inherit the cornerstone-blue treatment for free.

export const COL_FLOOR = "#16171B";
export const COL_FLOOR_TILE = "#1A1B20";
export const COL_WALL = "#1C1E23";
export const COL_WALL_DARK = "#181A1F";
export const COL_WALL_TRIM = "#22242A";
export const COL_BASEBOARD = "#0F1014";
export const COL_RULE = "#2E3038";

export const COL_DESK = "#2A2C33";
export const COL_DESK_TOP = "#33363E";
export const COL_DESK_LEG = "#1F2126";
export const COL_MON_BEZEL = "#0D0E11";
export const COL_MON_SCREEN = "#0A1620";
export const COL_MON_GLOW = "rgba(120, 180, 220, 0.55)";

export const COL_PLINTH = "#1E2026";
export const COL_PLINTH_TOP = "#2A2C33";
export const COL_PLAQUE = "#0E0F12";

export const COL_PLANT = "#3B6147";
export const COL_PLANT_DARK = "#274532";
export const COL_POT = "#5A4632";

export const COL_INK = "#E9E7E1";
export const COL_INK_DIM = "#8A8A85";
export const COL_INK_FAINT = "#4A4A47";

// Per-agent accent fallback palette. Used when an OfficeAgent doesn't
// declare an `accent` — picks deterministically by index so adding an
// agent to a template never blocks on someone choosing a colour.
// Lives here (not in character.tsx) so the office composer can resolve
// an agent's colour for station-overlay tinting without importing the
// sprite renderer.
export const ACCENT_FALLBACKS = [
  "#D9A464", // amber (cookbook-ish)
  "#76B8E1", // cornerstone blue
  "#7CB89E", // sage
  "#C28BD4", // violet
  "#E08D5C", // forge red
  "#7CD3C5", // cyan
  "#D9D8C7", // warm white
];

// Default colour for each station kind. Overridable per-station via
// `station.color`. Kept here (not inlined per kind) so a team-template
// editor can show a colour swatch by kind.
export const KIND_COLORS = {
  monolith: "#76B8E1", // memory / data pillar — cornerstone blue
  codex: "#D9A464", // skills / playbook — cookbook orange
  rack: "#D9D8C7", // storage / files — drive warm white
  globe: "#7CB89E", // research / external — sage
  cabinet: "#C8B89A", // archive / records — parchment
  radar: "#7CD3C5", // monitoring / observability — cyan
  forge: "#E08D5C", // build / deploy — forge red
} as const;
