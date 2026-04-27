// Floor — flat fill with subtle vertical tile stripes and a horizon
// seam. Phase 2 sprite shadows / movement happens above this layer.

import { COL_FLOOR, COL_FLOOR_TILE } from "./palette";
import { H, W, WALL_BOTTOM } from "./metrics";

export function Floor() {
  const stripes: number[] = [];
  for (let x = 0; x <= W; x += 64) stripes.push(x);
  return (
    <g>
      <rect x={0} y={WALL_BOTTOM} width={W} height={H - WALL_BOTTOM} fill={COL_FLOOR} />
      {stripes.map((sx) => (
        <rect key={sx} x={sx} y={WALL_BOTTOM + 2} width={1} height={H - WALL_BOTTOM - 2} fill={COL_FLOOR_TILE} />
      ))}
      <rect x={0} y={H - 80} width={W} height={1} fill={COL_FLOOR_TILE} />
    </g>
  );
}
