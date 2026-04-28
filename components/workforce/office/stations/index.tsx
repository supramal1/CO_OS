// Station registry — maps StationKind → render component. Adding a new
// kind is: (1) drop a file under this directory, (2) wire it here,
// (3) extend StationKind in ../types.ts. No other file needs to change.

import { KIND_COLORS } from "../palette";
import type { ReactElement } from "react";
import type { OfficeStation, StationKind } from "../types";
import { Cabinet } from "./cabinet";
import { Codex } from "./codex";
import { Forge } from "./forge";
import { Globe } from "./globe";
import { Monolith } from "./monolith";
import { Radar } from "./radar";
import { Rack } from "./rack";

type StationComponent = (props: {
  x: number;
  label: string;
  color: string;
}) => ReactElement;

const REGISTRY: Record<StationKind, StationComponent> = {
  monolith: Monolith,
  codex: Codex,
  rack: Rack,
  globe: Globe,
  cabinet: Cabinet,
  radar: Radar,
  forge: Forge,
};

export function StationByKind({ station, x }: { station: OfficeStation; x: number }) {
  const Component = REGISTRY[station.kind];
  const color = station.color ?? KIND_COLORS[station.kind];
  return <Component x={x} label={station.label} color={color} />;
}
