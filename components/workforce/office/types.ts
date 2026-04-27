// Office template schema. A team configures their pixel office by
// declaring an OfficeTemplate; the layout engine + station registry
// handle all rendering and placement.

export type StationKind =
  | "monolith" // memory / vault / data pillar — Cornerstone-style
  | "codex" // skills / playbook / runbook — Cookbook-style
  | "rack" // storage / files / drive — server rack
  | "globe" // research / external / web — globe on a stand
  | "cabinet" // archive / records — filing cabinet
  | "radar" // monitoring / observability — radar dish
  | "forge"; // build / deploy / publish — anvil + hammer

// Hair silhouette. The 12×11 face leaves room for one strong silhouette
// cue per agent — varying this is what makes five sprites read as five
// different people instead of "blue Ada + sage Margaret."
export type HairStyle =
  | "short" // default cap, no extras
  | "bun" // short cap + 3-pixel nub on top
  | "long" // cap + hair runs down past shoulders
  | "fringe" // sweeps over the forehead, partial brow cover
  | "bald"; // no top hair, side hair only at temples

export type FacialHair = "none" | "beard" | "stubble";

export type Headwear = "none" | "headband" | "visor";

export interface AgentAppearance {
  /** Skin fill colour. Defaults to a mid skin tone. */
  skinTone?: string;
  hairStyle?: HairStyle;
  facialHair?: FacialHair;
  glasses?: boolean;
  headwear?: Headwear;
}

export interface OfficeAgent {
  agentId: string;
  label: string;
  role: string;
  /** Marks the team Lead. At most one per template. Lead gets the front-
   *  centre desk; everyone else fills the back row first. */
  isLead?: boolean;
  /** Optional accent colour used for hair / shirt tinting on the sprite.
   *  Falls back to a deterministic palette keyed by agentId. */
  accent?: string;
  /** Per-agent silhouette cues (hair, facial hair, glasses, headwear,
   *  skin tone). Without this, every sprite uses the same default head
   *  and only varies by accent — five identical figures in different
   *  shirts. With it, each agent reads as a distinct person at a glance. */
  appearance?: AgentAppearance;
}

// Coarse semantic groups used by the working-state overlay glyph.
// Each family maps to a distinct shape rendered above the agent's head
// so a glance tells you what *kind* of thing the agent is doing —
// even when no station is involved (delegate, raw thinking, etc.).
export type ToolFamily =
  | "memory" // cornerstone reads/writes
  | "research" // web search / external lookup
  | "cookbook" // skill / playbook fetch
  | "build" // github / deploy / file ops
  | "delegate"; // ada handing work to a specialist

// Runtime state of a single agent. Drives which sprite renderer is used
// and (for `at_station`) where the sprite is positioned. Discriminated
// union so TS narrows `stationId` only on the at_station branch.
export type AgentState =
  | { kind: "idle" }
  | {
      kind: "working";
      /** When the agent is actively running a tool that doesn't map to
       *  a station (delegate, etc.) the family name surfaces above the
       *  head so the working state isn't visually identical for every
       *  in-flight call. Optional: a "thinking between calls" working
       *  state still renders the plain pulse marker. */
      toolFamily?: ToolFamily;
    }
  | { kind: "at_station"; stationId: string }
  | { kind: "waiting" }
  /**
   * The agent fired a destructive tool that the runner gated through
   * `requestApproval`. The Promise inside the substrate is still awaiting
   * an operator's decision in the inbox modal. Distinct from `waiting`
   * so the bubble can read "needs you" instead of "thinking…", and so
   * the wall-mounted inbox can highlight the right sprite.
   */
  | { kind: "awaiting_approval"; approvalId: string }
  | { kind: "complete" };

export interface OfficeStation {
  /** Stable key — Phase 2 sprites will use this to identify which
   *  station an agent is currently using. */
  id: string;
  label: string;
  kind: StationKind;
  /** Optional colour override. Defaults to KIND_COLORS[kind]. */
  color?: string;
}

export interface OfficeTemplate {
  /** Display name. Surfaces in dev preview / future team-picker UI. */
  name: string;
  /** 1–7 supported. Agents past 7 require either two-row front or
   *  scaling — defer until a real team needs it. */
  agents: OfficeAgent[];
  /** 0–4 supported. Stations past 4 require dropping a bookend or
   *  narrower stations — defer. */
  stations: OfficeStation[];
}

// ---------- Layout output (consumed by renderer) ----------

export interface PositionedAgent {
  agent: OfficeAgent;
  /** Top-left x of the desk top. */
  x: number;
  /** Top-left y of the desk top. */
  y: number;
}

export interface PositionedStation {
  station: OfficeStation;
  /** Top-left x of the station's slot. The slot is STATION_W wide; the
   *  station component decides how to centre its item within that slot. */
  x: number;
  /** Floor x where a sprite stands when using this station — slot centre
   *  minus half the sprite width. Sprite logic reads this; it should not
   *  recompute slot geometry. */
  accessX: number;
  /** Floor y where the sprite stands while using the station. Constant
   *  across stations (STATION_ACCESS_Y) but exposed here so the renderer
   *  doesn't need to import metrics. */
  accessY: number;
}

export interface OfficeLayout {
  agents: PositionedAgent[];
  stations: PositionedStation[];
}
