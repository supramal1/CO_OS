// Globe — globe on a wooden stand. Default kind for research / external /
// web surfaces (Research, Field, Web, etc.).

import { STATION_PLINTH_Y, STATION_W } from "../metrics";
import { StationAura, StationPlinth } from "../plinth";

export function Globe({ x, label, color }: { x: number; label: string; color: string }) {
  const top = 60;
  const cx = x + STATION_W / 2;
  const cy = STATION_PLINTH_Y - 64;
  const r = 36;
  return (
    <g>
      <StationAura x={x} color={color} itemTop={top} />
      {/* Stand */}
      <rect x={cx - 24} y={STATION_PLINTH_Y - 6} width={48} height={6} fill="#241B12" />
      <rect x={cx - 18} y={STATION_PLINTH_Y - 12} width={36} height={6} fill="#3A2D20" />
      <rect x={cx - 2} y={cy + r - 2} width={4} height={STATION_PLINTH_Y - (cy + r) + 4} fill="#3A2D20" />
      {/* Axis pin */}
      <rect x={cx - 1} y={cy - r - 6} width={2} height={6 + r * 2 + 12} fill="#241B12" />
      {/* Globe — square + cut corners */}
      <rect x={cx - r} y={cy - r + 4} width={r * 2} height={r * 2 - 8} fill="#1B3848" />
      <rect x={cx - r + 4} y={cy - r} width={r * 2 - 8} height={r * 2} fill="#1B3848" />
      <rect x={cx - r + 2} y={cy - r + 2} width={2} height={2} fill="#1B3848" />
      <rect x={cx + r - 4} y={cy - r + 2} width={2} height={2} fill="#1B3848" />
      <rect x={cx - r + 2} y={cy + r - 4} width={2} height={2} fill="#1B3848" />
      <rect x={cx + r - 4} y={cy + r - 4} width={2} height={2} fill="#1B3848" />
      {/* Continents */}
      <rect x={cx - 22} y={cy - 16} width={14} height={10} fill={color} />
      <rect x={cx - 14} y={cy - 22} width={6} height={6} fill={color} />
      <rect x={cx - 4} y={cy - 8} width={20} height={12} fill={color} />
      <rect x={cx + 6} y={cy + 6} width={14} height={10} fill={color} />
      <rect x={cx - 18} y={cy + 8} width={10} height={6} fill={color} />
      <rect x={cx + 14} y={cy - 14} width={6} height={4} fill={color} />
      <rect x={cx - r + 4} y={cy} width={r * 2 - 8} height={1} fill={color} opacity={0.4} />
      <rect x={cx - r + 8} y={cy - r + 6} width={6} height={2} fill="#9CD3BC" opacity={0.6} />
      <StationPlinth x={x} label={label} color={color} />
    </g>
  );
}
