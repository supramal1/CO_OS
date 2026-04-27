// Radar — dish on a tripod stand with pulse rings. Default kind for
// monitoring / observability / alerts surfaces.

import { STATION_PLINTH_Y, STATION_W } from "../metrics";
import { StationAura, StationPlinth } from "../plinth";

export function Radar({ x, label, color }: { x: number; label: string; color: string }) {
  const top = 40;
  const cx = x + STATION_W / 2;
  const dishY = top + 8;
  return (
    <g>
      <StationAura x={x} color={color} itemTop={top} />
      {/* Pulse rings — concentric arcs approximated as nested rects */}
      <rect x={cx - 50} y={dishY + 12} width={100} height={2} fill={color} opacity={0.12} />
      <rect x={cx - 38} y={dishY + 6} width={76} height={2} fill={color} opacity={0.18} />
      <rect x={cx - 26} y={dishY} width={52} height={2} fill={color} opacity={0.28} />
      {/* Dish — semicircle approximated as stepped rectangles */}
      <rect x={cx - 32} y={dishY + 14} width={64} height={6} fill="#26282E" />
      <rect x={cx - 28} y={dishY + 10} width={56} height={4} fill="#33363D" />
      <rect x={cx - 22} y={dishY + 6} width={44} height={4} fill="#3A3D44" />
      <rect x={cx - 14} y={dishY + 2} width={28} height={4} fill="#43464E" />
      {/* Dish inner colour band */}
      <rect x={cx - 26} y={dishY + 14} width={52} height={2} fill={color} opacity={0.45} />
      {/* Feed horn */}
      <rect x={cx - 2} y={dishY - 8} width={4} height={10} fill="#1A1C20" />
      <rect x={cx - 4} y={dishY - 12} width={8} height={4} fill={color} />
      {/* Stand */}
      <rect x={cx - 2} y={dishY + 20} width={4} height={STATION_PLINTH_Y - (dishY + 20)} fill="#1F2126" />
      {/* Tripod feet */}
      <rect x={cx - 22} y={STATION_PLINTH_Y - 12} width={16} height={6} fill="#1F2126" />
      <rect x={cx + 6} y={STATION_PLINTH_Y - 12} width={16} height={6} fill="#1F2126" />
      <rect x={cx - 24} y={STATION_PLINTH_Y - 6} width={48} height={4} fill="#0E0F12" />
      {/* Status pulse dot */}
      <rect x={cx - 1} y={dishY + 16} width={2} height={2} fill="#FFFFFF" opacity={0.9} />
      <StationPlinth x={x} label={label} color={color} />
    </g>
  );
}
