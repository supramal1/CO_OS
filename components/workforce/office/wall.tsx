// Back wall — fill, vertical seams, horizon line, baseboard, top trim,
// and the two bookend props (window left, plant shelf right). Stations
// render *between* the bookends but live in pixel-office.tsx as a
// sibling so the wall can stay agent-agnostic.

import {
  COL_BASEBOARD,
  COL_PLANT,
  COL_PLANT_DARK,
  COL_POT,
  COL_RULE,
  COL_WALL,
  COL_WALL_DARK,
  COL_WALL_TRIM,
  KIND_COLORS,
} from "./palette";
import { W, WALL_BOTTOM } from "./metrics";

export function BackWall() {
  return (
    <g>
      <rect x={0} y={0} width={W} height={WALL_BOTTOM} fill={COL_WALL} />
      {[256, 512, 768].map((x) => (
        <rect key={x} x={x} y={0} width={1} height={WALL_BOTTOM} fill={COL_WALL_DARK} />
      ))}
      <rect x={0} y={WALL_BOTTOM} width={W} height={2} fill={COL_RULE} />
      <rect x={0} y={WALL_BOTTOM + 2} width={W} height={4} fill={COL_BASEBOARD} />
      <rect x={0} y={6} width={W} height={2} fill={COL_WALL_TRIM} />
      <Window x={16} y={36} />
      <PlantShelf x={860} y={64} />
    </g>
  );
}

function Window({ x, y }: { x: number; y: number }) {
  const w = 144;
  const h = 116;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#0E0F12" />
      <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} fill="#0A1822" />
      <rect x={x + 4} y={y + 4} width={w - 8} height={28} fill="#13283A" />
      <rect x={x + 4} y={y + 32} width={w - 8} height={36} fill="#0F2030" />
      <rect x={x + 4} y={y + 68} width={w - 8} height={h - 72} fill="#0B1622" />
      <rect x={x + w / 2 - 1} y={y + 4} width={2} height={h - 8} fill="#0E0F12" />
      <rect x={x + 4} y={y + h / 2 - 1} width={w - 8} height={2} fill="#0E0F12" />
      <rect x={x - 4} y={y + h} width={w + 8} height={6} fill="#1A1C22" />
      <rect x={x + 12} y={y + h - 18} width={20} height={12} fill={COL_POT} />
      <rect x={x + 8} y={y + h - 28} width={28} height={12} fill={COL_PLANT} />
      <rect x={x + 14} y={y + h - 34} width={16} height={8} fill={COL_PLANT_DARK} />
    </g>
  );
}

function PlantShelf({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y + 80} width={140} height={6} fill="#2A2118" />
      <rect x={x + 4} y={y + 86} width={132} height={2} fill="#1F1810" />
      {/* Plant 1 */}
      <rect x={x + 14} y={y + 54} width={20} height={26} fill={COL_POT} />
      <rect x={x + 10} y={y + 30} width={28} height={26} fill={COL_PLANT} />
      <rect x={x + 16} y={y + 20} width={16} height={14} fill={COL_PLANT_DARK} />
      <rect x={x + 18} y={y + 12} width={12} height={10} fill={COL_PLANT} />
      {/* Plant 2 */}
      <rect x={x + 50} y={y + 62} width={28} height={18} fill={COL_POT} />
      <rect x={x + 44} y={y + 44} width={40} height={20} fill={COL_PLANT} />
      <rect x={x + 50} y={y + 38} width={28} height={8} fill={COL_PLANT_DARK} />
      {/* Books — neutral colours so the shelf stays kind-agnostic */}
      <rect x={x + 96} y={y + 66} width={32} height={14} fill={KIND_COLORS.codex} />
      <rect x={x + 100} y={y + 54} width={24} height={12} fill={KIND_COLORS.monolith} />
      <rect x={x + 104} y={y + 44} width={20} height={10} fill={KIND_COLORS.rack} />
    </g>
  );
}
