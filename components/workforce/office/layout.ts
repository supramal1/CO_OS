// Pure layout engine. Takes a template, returns positioned agents and
// stations. No DOM, no SVG, no React — Phase 2 will use the same output
// to compute sprite walk paths.

import {
  BACK_ROW_Y,
  CHAR_W,
  DESK_W,
  FLOOR_BAND_W,
  FLOOR_LEFT,
  FRONT_ROW_Y,
  MAX_BACK_ROW,
  STATION_ACCESS_Y,
  STATION_BAND_LEFT,
  STATION_BAND_W,
  STATION_W,
} from "./metrics";
import type {
  OfficeAgent,
  OfficeLayout,
  OfficeStation,
  OfficeTemplate,
  PositionedAgent,
  PositionedStation,
} from "./types";

const STATION_GAP_MAX = 80;
const DESK_GAP_MAX = 240;

export function layoutOffice(template: OfficeTemplate): OfficeLayout {
  if (template.agents.length > 7) {
    throw new Error(
      `office_template_too_many_agents: ${template.agents.length} > 7. Add a second front row before scaling.`,
    );
  }
  if (template.stations.length > 4) {
    throw new Error(
      `office_template_too_many_stations: ${template.stations.length} > 4. Drop a bookend or narrow stations before scaling.`,
    );
  }
  if (template.agents.filter((a) => a.isLead).length > 1) {
    throw new Error("office_template_multiple_leads: only one agent may be isLead=true.");
  }

  return {
    agents: placeAgents(template.agents),
    stations: placeStations(template.stations),
  };
}

function placeStations(stations: OfficeStation[]): PositionedStation[] {
  const n = stations.length;
  if (n === 0) return [];
  const xs = distribute(n, STATION_BAND_LEFT, STATION_BAND_W, STATION_W, STATION_GAP_MAX);
  return stations.map((station, i) => {
    const x = xs[i];
    const slotCentre = x + STATION_W / 2;
    return {
      station,
      x,
      accessX: slotCentre - CHAR_W / 2,
      accessY: STATION_ACCESS_Y,
    };
  });
}

function placeAgents(agents: OfficeAgent[]): PositionedAgent[] {
  const lead = agents.find((a) => a.isLead);
  const others = agents.filter((a) => !a.isLead);

  // No lead → all in back row, overflow to front row (no centring trick).
  if (!lead) {
    const back = others.slice(0, MAX_BACK_ROW);
    const front = others.slice(MAX_BACK_ROW);
    return [
      ...positionRow(back, BACK_ROW_Y),
      ...positionRow(front, FRONT_ROW_Y),
    ];
  }

  // With a lead: specialists fill the back row first; lead sits front-
  // centre with any overflow specialists flanking.
  const back = others.slice(0, MAX_BACK_ROW);
  const overflow = others.slice(MAX_BACK_ROW);
  const front = interleaveLeadCentre(overflow, lead);
  return [
    ...positionRow(back, BACK_ROW_Y),
    ...positionRow(front, FRONT_ROW_Y),
  ];
}

function positionRow(agents: OfficeAgent[], y: number): PositionedAgent[] {
  if (agents.length === 0) return [];
  const xs = distribute(agents.length, FLOOR_LEFT, FLOOR_BAND_W, DESK_W, DESK_GAP_MAX);
  return agents.map((agent, i) => ({ agent, x: xs[i], y }));
}

function interleaveLeadCentre<T>(arr: T[], lead: T): T[] {
  // Lead sits in the centre; other agents flank evenly on each side.
  const half = Math.floor(arr.length / 2);
  return [...arr.slice(0, half), lead, ...arr.slice(half)];
}

/**
 * Centre `n` items of width `itemW` inside a band, with gap capped at
 * `gapMax` so 2-item rows don't read as "two desks at opposite ends of
 * an empty room."
 */
function distribute(
  n: number,
  bandLeft: number,
  bandWidth: number,
  itemW: number,
  gapMax: number,
): number[] {
  if (n === 1) return [bandLeft + (bandWidth - itemW) / 2];
  const idealGap = (bandWidth - n * itemW) / (n - 1);
  const gap = Math.min(idealGap, gapMax);
  const totalUsed = n * itemW + (n - 1) * gap;
  const start = bandLeft + (bandWidth - totalUsed) / 2;
  return Array.from({ length: n }, (_, i) => start + i * (itemW + gap));
}
