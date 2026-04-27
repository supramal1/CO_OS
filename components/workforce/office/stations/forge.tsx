// Forge — anvil on a stone base with a hammer hanging above. Default
// kind for build / deploy / publish surfaces.

import { STATION_PLINTH_Y, STATION_W } from "../metrics";
import { StationAura, StationPlinth } from "../plinth";

export function Forge({ x, label, color }: { x: number; label: string; color: string }) {
  const top = 36;
  const cx = x + STATION_W / 2;
  return (
    <g>
      <StationAura x={x} color={color} itemTop={top} />
      {/* Hammer hanging from a peg */}
      <rect x={cx - 1} y={top} width={2} height={28} fill="#3A2D20" />
      {/* Hammer head */}
      <rect x={cx - 16} y={top + 28} width={32} height={14} fill="#3A3D44" />
      <rect x={cx - 16} y={top + 28} width={32} height={2} fill="#4A4D56" />
      <rect x={cx - 14} y={top + 30} width={4} height={10} fill="#26282E" />
      <rect x={cx + 10} y={top + 30} width={4} height={10} fill="#26282E" />
      {/* Hammer shaft */}
      <rect x={cx - 2} y={top + 42} width={4} height={20} fill="#3A2D20" />
      <rect x={cx - 2} y={top + 42} width={4} height={1} fill="#4A3825" />

      {/* Anvil */}
      <rect x={cx - 36} y={STATION_PLINTH_Y - 50} width={72} height={6} fill="#26282E" />
      <rect x={cx - 30} y={STATION_PLINTH_Y - 44} width={60} height={4} fill="#1F2126" />
      <rect x={cx - 12} y={STATION_PLINTH_Y - 40} width={24} height={14} fill="#33363D" />
      <rect x={cx - 22} y={STATION_PLINTH_Y - 26} width={44} height={6} fill="#1F2126" />
      {/* Anvil horn */}
      <rect x={cx + 26} y={STATION_PLINTH_Y - 50} width={14} height={4} fill="#26282E" />
      <rect x={cx + 32} y={STATION_PLINTH_Y - 46} width={8} height={2} fill="#1F2126" />
      {/* Glow under anvil */}
      <rect x={cx - 28} y={STATION_PLINTH_Y - 20} width={56} height={2} fill={color} opacity={0.6} />
      <rect x={cx - 22} y={STATION_PLINTH_Y - 18} width={44} height={2} fill={color} opacity={0.3} />
      {/* Stone base */}
      <rect x={cx - 32} y={STATION_PLINTH_Y - 16} width={64} height={16} fill="#3A3D44" />
      <rect x={cx - 32} y={STATION_PLINTH_Y - 16} width={64} height={2} fill="#4A4D56" />
      {/* Stone block striations */}
      <rect x={cx - 32} y={STATION_PLINTH_Y - 8} width={64} height={1} fill="#26282E" />
      <rect x={cx - 12} y={STATION_PLINTH_Y - 16} width={1} height={16} fill="#26282E" />
      <rect x={cx + 12} y={STATION_PLINTH_Y - 16} width={1} height={16} fill="#26282E" />
      {/* Sparks */}
      <rect x={cx - 8} y={STATION_PLINTH_Y - 36} width={2} height={2} fill={color} />
      <rect x={cx + 4} y={STATION_PLINTH_Y - 38} width={2} height={2} fill={color} opacity={0.7} />
      <rect x={cx - 14} y={STATION_PLINTH_Y - 30} width={2} height={2} fill={color} opacity={0.5} />
      <StationPlinth x={x} label={label} color={color} />
    </g>
  );
}
