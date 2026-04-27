// Monolith — vertical stone pillar with a glowing rune. Default kind for
// memory / vault / data-pillar surfaces (Cornerstone, Vault, etc.).

import { STATION_PLINTH_Y, STATION_W } from "../metrics";
import { StationAura, StationPlinth } from "../plinth";

export function Monolith({ x, label, color }: { x: number; label: string; color: string }) {
  const top = 38;
  const pillarW = 56;
  const pillarX = x + (STATION_W - pillarW) / 2;
  const rows = 7;
  const blocks: { rx: number; ry: number; shade: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 2; c++) {
      const offset = r % 2 === 0 ? 0 : 4;
      blocks.push({
        rx: pillarX + 2 + c * 26 + offset,
        ry: top + 4 + r * 22,
        shade: (r + c) % 2,
      });
    }
  }
  return (
    <g>
      <StationAura x={x} color={color} itemTop={top} />
      <rect x={pillarX - 6} y={top - 6} width={pillarW + 12} height={4} fill="#0F1014" />
      <rect x={pillarX} y={top} width={pillarW} height={STATION_PLINTH_Y - top} fill="#3A3D44" />
      {blocks.map((b, i) => (
        <rect
          key={i}
          x={b.rx}
          y={b.ry}
          width={22}
          height={20}
          fill={b.shade ? "#43464E" : "#33363D"}
        />
      ))}
      {/* Rune */}
      <rect x={pillarX + pillarW / 2 - 2} y={top + 78} width={4} height={20} fill={color} />
      <rect x={pillarX + pillarW / 2 - 10} y={top + 86} width={20} height={4} fill={color} />
      <rect x={pillarX + pillarW / 2 - 6} y={top + 82} width={12} height={12} fill={color} opacity={0.25} />
      <rect x={pillarX - 4} y={top - 2} width={pillarW + 8} height={4} fill="#4A4D56" />
      <StationPlinth x={x} label={label} color={color} />
    </g>
  );
}
