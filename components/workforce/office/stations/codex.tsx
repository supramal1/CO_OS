// Codex — open book on a lectern with bound stacks behind. Default kind
// for skills / playbook / runbook surfaces (Cookbook, Playbook, etc.).

import { STATION_PLINTH_Y, STATION_W } from "../metrics";
import { StationAura, StationPlinth } from "../plinth";

export function Codex({ x, label, color }: { x: number; label: string; color: string }) {
  const top = 48;
  return (
    <g>
      <StationAura x={x} color={color} itemTop={top} />
      {/* Lectern */}
      <rect x={x + STATION_W / 2 - 44} y={STATION_PLINTH_Y - 56} width={88} height={56} fill="#3A2D20" />
      <rect x={x + STATION_W / 2 - 44} y={STATION_PLINTH_Y - 56} width={88} height={4} fill="#4A3825" />
      <rect x={x + STATION_W / 2 - 40} y={STATION_PLINTH_Y - 6} width={4} height={6} fill="#241B12" />
      <rect x={x + STATION_W / 2 + 36} y={STATION_PLINTH_Y - 6} width={4} height={6} fill="#241B12" />
      {/* Open book on lectern */}
      <rect x={x + STATION_W / 2 - 40} y={STATION_PLINTH_Y - 64} width={80} height={10} fill="#241B12" />
      <rect x={x + STATION_W / 2 - 38} y={STATION_PLINTH_Y - 76} width={36} height={14} fill="#F2EAD8" />
      <rect x={x + STATION_W / 2 + 2} y={STATION_PLINTH_Y - 76} width={36} height={14} fill="#F2EAD8" />
      <rect x={x + STATION_W / 2 - 34} y={STATION_PLINTH_Y - 72} width={28} height={1} fill="#5A4632" />
      <rect x={x + STATION_W / 2 - 34} y={STATION_PLINTH_Y - 68} width={20} height={1} fill="#5A4632" />
      <rect x={x + STATION_W / 2 + 6} y={STATION_PLINTH_Y - 72} width={28} height={1} fill="#5A4632" />
      <rect x={x + STATION_W / 2 + 6} y={STATION_PLINTH_Y - 68} width={24} height={1} fill="#5A4632" />
      <rect x={x + STATION_W / 2 - 1} y={STATION_PLINTH_Y - 76} width={2} height={14} fill={color} />
      {/* Book stacks left + right */}
      <rect x={x + 14} y={top + 8} width={32} height={12} fill={color} />
      <rect x={x + 18} y={top + 20} width={28} height={12} fill="#A6753A" />
      <rect x={x + 12} y={top + 32} width={36} height={12} fill={color} />
      <rect x={x + STATION_W - 50} y={top + 4} width={36} height={12} fill="#A6753A" />
      <rect x={x + STATION_W - 46} y={top + 16} width={28} height={12} fill={color} />
      <rect x={x + STATION_W - 50} y={top + 28} width={36} height={12} fill="#A6753A" />
      <rect x={x + STATION_W - 44} y={top + 40} width={26} height={12} fill={color} />
      <rect x={x + STATION_W / 2 - 4} y={top + 4} width={8} height={4} fill={color} opacity={0.4} />
      <StationPlinth x={x} label={label} color={color} />
    </g>
  );
}
