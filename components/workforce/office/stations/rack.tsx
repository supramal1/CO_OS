// Rack — slim server cabinet with rack-units stacked. Default kind for
// storage / files / drive surfaces (Drive, S3, Files, etc.).

import { STATION_PLINTH_Y, STATION_W } from "../metrics";
import { StationAura, StationPlinth } from "../plinth";

export function Rack({ x, label, color }: { x: number; label: string; color: string }) {
  const top = 30;
  const rackW = 84;
  const rackX = x + (STATION_W - rackW) / 2;
  const units = 9;
  const unitH = 16;
  return (
    <g>
      <StationAura x={x} color={color} itemTop={top} />
      <rect x={rackX - 4} y={top - 4} width={rackW + 8} height={STATION_PLINTH_Y - top + 4} fill="#0E0F12" />
      <rect x={rackX} y={top} width={rackW} height={STATION_PLINTH_Y - top} fill="#1A1C20" />
      {Array.from({ length: units }).map((_, i) => {
        const uy = top + 6 + i * unitH;
        return (
          <g key={i}>
            <rect x={rackX + 4} y={uy} width={rackW - 8} height={unitH - 4} fill="#26282E" />
            <rect x={rackX + 8} y={uy + 3} width={36} height={1} fill="#0E0F12" />
            <rect x={rackX + 8} y={uy + 6} width={36} height={1} fill="#0E0F12" />
            <rect
              x={rackX + rackW - 12}
              y={uy + 4}
              width={2}
              height={2}
              fill={i % 3 === 0 ? color : "#3DAA66"}
            />
            <rect
              x={rackX + rackW - 8}
              y={uy + 4}
              width={2}
              height={2}
              fill={i % 4 === 0 ? "#3DAA66" : "#1F1F1F"}
            />
          </g>
        );
      })}
      <rect x={rackX + 6} y={top + 1} width={rackW - 12} height={3} fill="#0E0F12" />
      <StationPlinth x={x} label={label} color={color} />
    </g>
  );
}
