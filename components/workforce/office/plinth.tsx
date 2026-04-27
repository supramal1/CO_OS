// Shared plinth + plaque. Every station mounts on this — gives the wall
// stations a consistent base with a small etched label so the eye reads
// them as a row of like-objects rather than scattered furniture.

import { COL_BASEBOARD, COL_PLAQUE, COL_PLINTH, COL_PLINTH_TOP } from "./palette";
import { STATION_PLINTH_H, STATION_PLINTH_Y, STATION_W } from "./metrics";

export function StationPlinth({
  x,
  label,
  color,
}: {
  x: number;
  label: string;
  color: string;
}) {
  return (
    <g>
      {/* Plinth */}
      <rect x={x} y={STATION_PLINTH_Y} width={STATION_W} height={STATION_PLINTH_H} fill={COL_PLINTH} />
      <rect x={x} y={STATION_PLINTH_Y} width={STATION_W} height={2} fill={COL_PLINTH_TOP} />
      <rect x={x} y={STATION_PLINTH_Y + STATION_PLINTH_H} width={STATION_W} height={2} fill={COL_BASEBOARD} />
      {/* Plaque */}
      <rect
        x={x + STATION_W / 2 - 52}
        y={STATION_PLINTH_Y + 3}
        width={104}
        height={STATION_PLINTH_H - 6}
        fill={COL_PLAQUE}
      />
      <rect
        x={x + STATION_W / 2 - 52}
        y={STATION_PLINTH_Y + 3}
        width={104}
        height={1}
        fill={color}
        opacity={0.6}
      />
      <text
        x={x + STATION_W / 2}
        y={STATION_PLINTH_Y + 11}
        textAnchor="middle"
        fontFamily="var(--font-plex-mono), ui-monospace, monospace"
        fontSize={8}
        letterSpacing="0.22em"
        fill={color}
        style={{ textTransform: "uppercase" }}
      >
        {label.toUpperCase()}
      </text>
    </g>
  );
}

export function StationAura({
  x,
  color,
  itemTop,
}: {
  x: number;
  color: string;
  itemTop: number;
}) {
  // Faint zone-coloured halo behind the item. Subtle by design — the
  // items themselves carry most of the colour identity.
  return (
    <g>
      <rect
        x={x + STATION_W / 2 - 60}
        y={itemTop - 6}
        width={120}
        height={STATION_PLINTH_Y - itemTop + 6}
        fill={color}
        opacity={0.04}
      />
      <rect
        x={x + STATION_W / 2 - 28}
        y={itemTop - 4}
        width={56}
        height={4}
        fill={color}
        opacity={0.18}
      />
    </g>
  );
}

// Active-agent pulse overlay for a station. Rendered after the station
// itself so it sits above the existing aura. Tinted to the visiting
// agent's accent so the office reads as "Margaret is at the globe" not
// "someone is at the globe." Pulses on a slower cadence than the
// working-dot so the effect feels like the station listening.
export function StationActivePulse({
  x,
  accent,
  itemTop,
}: {
  x: number;
  accent: string;
  itemTop: number;
}) {
  const auraX = x + STATION_W / 2 - 60;
  const auraY = itemTop - 8;
  const auraW = 120;
  const auraH = STATION_PLINTH_Y - itemTop + 8;
  const ringX = x + STATION_W / 2 - 32;
  const ringY = itemTop - 6;
  const ringW = 64;
  const ringH = 4;
  return (
    <g className="co-station-pulse" pointerEvents="none">
      {/* Wider tinted halo — pulses opacity 0.06 → 0.22. */}
      <rect x={auraX} y={auraY} width={auraW} height={auraH} fill={accent} />
      {/* Bright top stripe — visible "active" cue along the station's
          item baseline. */}
      <rect x={ringX} y={ringY} width={ringW} height={ringH} fill={accent} />
      {/* Two side ticks so the pulse reads as a ring not a stripe. */}
      <rect x={ringX - 4} y={ringY + ringH / 2 - 1} width={4} height={2} fill={accent} />
      <rect x={ringX + ringW} y={ringY + ringH / 2 - 1} width={4} height={2} fill={accent} />
    </g>
  );
}
