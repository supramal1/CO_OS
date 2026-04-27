// Cabinet — 4-drawer filing cabinet with handles + label cards. Default
// kind for archive / records / ledger surfaces.

import { STATION_PLINTH_Y, STATION_W } from "../metrics";
import { StationAura, StationPlinth } from "../plinth";

export function Cabinet({ x, label, color }: { x: number; label: string; color: string }) {
  const top = 40;
  const cabW = 76;
  const cabH = STATION_PLINTH_Y - top;
  const cabX = x + (STATION_W - cabW) / 2;
  const drawerH = (cabH - 8) / 4;
  return (
    <g>
      <StationAura x={x} color={color} itemTop={top} />
      {/* Cabinet body */}
      <rect x={cabX - 4} y={top - 4} width={cabW + 8} height={cabH + 4} fill="#0E0F12" />
      <rect x={cabX} y={top} width={cabW} height={cabH} fill="#3A3D44" />
      <rect x={cabX} y={top} width={cabW} height={2} fill="#4A4D56" />
      {Array.from({ length: 4 }).map((_, i) => {
        const dy = top + 4 + i * drawerH;
        return (
          <g key={i}>
            {/* Drawer face */}
            <rect x={cabX + 4} y={dy} width={cabW - 8} height={drawerH - 4} fill="#2A2C33" />
            {/* Drawer top edge */}
            <rect x={cabX + 4} y={dy} width={cabW - 8} height={1} fill="#43464E" />
            {/* Label card */}
            <rect x={cabX + 10} y={dy + 6} width={28} height={10} fill="#F2EAD8" />
            <rect x={cabX + 12} y={dy + 9} width={20} height={1} fill="#5A4632" />
            <rect x={cabX + 12} y={dy + 12} width={16} height={1} fill="#5A4632" />
            {/* Handle */}
            <rect x={cabX + cabW - 22} y={dy + (drawerH - 4) / 2 - 2} width={14} height={4} fill={color} />
            <rect x={cabX + cabW - 22} y={dy + (drawerH - 4) / 2 - 2} width={14} height={1} fill="#FFFFFF" opacity={0.2} />
          </g>
        );
      })}
      <StationPlinth x={x} label={label} color={color} />
    </g>
  );
}
