// Desk unit — split into back + front passes so a sprite can render in
// between. The split is what lets walking transitions work: the sprite
// keeps stable React identity (single render pass) while the monitor
// still occludes the torso/legs when the agent is "at desk."
//
//   Desk         → back layer (stand, top, body, legs, peripherals,
//                   nameplate). All of this sits below the sprite or
//                   below the monitor.
//   DeskMonitor  → front layer (bezel + screen + glow). The only piece
//                   that overlaps the sprite vertically.
//
// Pure renderers; positions come from the layout engine.

import {
  COL_DESK,
  COL_DESK_LEG,
  COL_DESK_TOP,
  COL_INK,
  COL_INK_DIM,
  COL_MON_BEZEL,
  COL_MON_GLOW,
  COL_MON_SCREEN,
  KIND_COLORS,
} from "./palette";
import { DESK_H, DESK_W } from "./metrics";
import type { PositionedAgent } from "./types";

export function Desk({ positioned }: { positioned: PositionedAgent }) {
  const { x, y } = positioned;
  const { label, role } = positioned.agent;
  return (
    <g>
      {/* Monitor stand — sits below the sprite's bottom edge, so it's
          safe to keep on the back layer. */}
      <rect x={x + DESK_W / 2 - 3} y={y - 4} width={6} height={8} fill={COL_MON_BEZEL} />
      <rect x={x + DESK_W / 2 - 14} y={y + 2} width={28} height={4} fill={COL_MON_BEZEL} />
      {/* Desk top + legs */}
      <rect x={x} y={y} width={DESK_W} height={6} fill={COL_DESK_TOP} />
      <rect x={x} y={y + 6} width={DESK_W} height={DESK_H - 6} fill={COL_DESK} />
      <rect x={x + 6} y={y + DESK_H} width={6} height={20} fill={COL_DESK_LEG} />
      <rect x={x + DESK_W - 12} y={y + DESK_H} width={6} height={20} fill={COL_DESK_LEG} />
      {/* Keyboard, mouse, mug */}
      <rect x={x + DESK_W / 2 - 28} y={y + 18} width={56} height={10} fill="#1A1C20" />
      <rect x={x + DESK_W / 2 - 26} y={y + 20} width={52} height={2} fill="#2A2C33" />
      <rect x={x + DESK_W / 2 - 26} y={y + 24} width={52} height={2} fill="#2A2C33" />
      <rect x={x + DESK_W / 2 + 32} y={y + 20} width={10} height={8} fill="#1A1C20" />
      <rect x={x + 16} y={y + 14} width={12} height={14} fill={KIND_COLORS.codex} />
      <rect x={x + 28} y={y + 18} width={3} height={6} fill={KIND_COLORS.codex} />
      {/* Nameplate */}
      <text
        x={x + DESK_W / 2}
        y={y + DESK_H + 36}
        textAnchor="middle"
        fontFamily="var(--font-plex-mono), ui-monospace, monospace"
        fontSize={11}
        letterSpacing="0.18em"
        fill={COL_INK}
        style={{ textTransform: "uppercase" }}
      >
        {label.toUpperCase()}
      </text>
      <text
        x={x + DESK_W / 2}
        y={y + DESK_H + 50}
        textAnchor="middle"
        fontFamily="var(--font-plex-mono), ui-monospace, monospace"
        fontSize={9}
        letterSpacing="0.16em"
        fill={COL_INK_DIM}
        style={{ textTransform: "uppercase" }}
      >
        {role.toUpperCase()}
      </text>
    </g>
  );
}

// Front layer — renders AFTER sprites in the composer so it occludes the
// sprite's torso and legs when the agent is at the desk. The sprite's
// head sits above the monitor top (sprite y = positioned.y − 48,
// monitor top = positioned.y − 32), so heads still poke out — exactly
// the visual we had before the split, but now compatible with a single
// sprite render pass.
export function DeskMonitor({ positioned }: { positioned: PositionedAgent }) {
  const { x, y } = positioned;
  const monW = 56;
  const monH = 36;
  const monX = x + (DESK_W - monW) / 2;
  const monY = y - monH + 4;
  return (
    <g>
      <rect x={monX} y={monY} width={monW} height={monH} fill={COL_MON_BEZEL} />
      <rect x={monX + 3} y={monY + 3} width={monW - 6} height={monH - 6} fill={COL_MON_SCREEN} />
      <rect x={monX + 6} y={monY + 7} width={20} height={2} fill={COL_MON_GLOW} />
      <rect x={monX + 6} y={monY + 12} width={32} height={2} fill={COL_MON_GLOW} />
      <rect x={monX + 6} y={monY + 17} width={14} height={2} fill={COL_MON_GLOW} />
      <rect x={monX + 6} y={monY + 22} width={26} height={2} fill={COL_MON_GLOW} />
    </g>
  );
}
