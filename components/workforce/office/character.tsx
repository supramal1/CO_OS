// Character sprite — one component, 5 states.
//
// A 24×40 pixel figure rendered as primitive SVG rects. The outer
// <Character> resolves position from layout + state, then dispatches to
// a per-state body renderer. All renderers share the same head/torso
// vocabulary so per-agent identity reads as "same person, different
// pose" rather than five unrelated portraits.
//
// Position rules:
//   - working / idle / waiting / complete  → at the agent's desk, with
//     legs hidden behind the desk body.
//   - at_station(stationId)                → on the floor in front of
//     the station's plinth (uses layout-supplied accessX/accessY).
//
// Accent colour drives hair + shirt. If the agent has no `accent` field
// we fall back to a deterministic palette so adding an agent never
// blocks on someone picking a colour.

import { CHAR_W, DESK_W } from "./metrics";
import { ACCENT_FALLBACKS, COL_INK_DIM } from "./palette";
import type {
  AgentAppearance,
  AgentState,
  OfficeAgent,
  OfficeLayout,
  PositionedAgent,
  PositionedStation,
  ToolFamily,
} from "./types";

// Default skin / hair-shadow / pants. Skin can be overridden per agent
// via OfficeAgent.appearance.skinTone. Accent (hair top + shirt) and the
// silhouette cues (hair shape, glasses, beard, headwear) vary per agent.
const COL_SKIN_DEFAULT = "#D9B894";
const COL_HAIR_SHADOW = "#1C1A18";
const COL_PANTS = "#23252B";
const COL_SHOE = "#0F1014";
const COL_EYE = "#0A0A0A";
const COL_GLASSES = "#1A1B20";
// Overlays sit on the dark wall; bubble/badge fills need to read against
// COL_WALL (#1C1E23). Anything below ~#444 disappears.
const COL_BUBBLE = "#D9D8C7";
const COL_BUBBLE_INK = "#0E0F12";
const COL_OK = "#7CB89E";
const COL_OK_DARK = "#1A2A22";
// Working focus marker — same cyan as the monitor glow.
const COL_FOCUS = "#76B8E1";
const COL_FOCUS_RING = "#1F3850";

export interface CharacterProps {
  positioned: PositionedAgent;
  state: AgentState;
  layout: OfficeLayout;
  /** Index of the agent in the template — used for the accent fallback
   *  so two agents without explicit accents still differ visibly. */
  index: number;
  /** When set, the sprite becomes a button: cursor: pointer, expanded
   *  hit target, ARIA role/label, fires onClick with the agentId. */
  onClick?: (agentId: string) => void;
  /** Highlights the sprite with a soft accent ring — used when the
   *  agent panel is open for that agent so the office shows what the
   *  panel is anchored to. */
  selected?: boolean;
}

export function Character({
  positioned,
  state,
  layout,
  index,
  onClick,
  selected,
}: CharacterProps) {
  const { agent } = positioned;
  const accent = agent.accent ?? ACCENT_FALLBACKS[index % ACCENT_FALLBACKS.length];
  const skin = agent.appearance?.skinTone ?? COL_SKIN_DEFAULT;
  const skinShadow = darken(skin, 56);
  const pos = resolvePosition(positioned, state, layout);
  if (!pos) return null;

  const { x, y } = pos;
  const label = `${agent.label} — ${describeState(state)}`;
  const isWalking = state.kind === "at_station";
  const interactive = Boolean(onClick);

  // For at_station, resolve a verb + stripe colour from the station's
  // kind so the speech-bubble overlay can carry the same info as the
  // working+toolFamily case. Done here (not in StateOverlay) because the
  // overlay shouldn't need to know about the layout.
  const atStationCue =
    state.kind === "at_station"
      ? resolveStationCue(state.stationId, layout)
      : null;

  // CSS transform with a transition is what makes walking work: when
  // state changes from desk → station (or back), x/y change, the
  // browser tweens the transform string, and the sprite slides across
  // the floor. Body and overlay both ride on this transform, so the
  // speech bubble / focus dot move with the head.
  return (
    <g
      aria-label={label}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={isWalking ? "co-sprite co-sprite-walking" : "co-sprite"}
      style={{
        transform: `translate(${x}px, ${y}px)`,
        transition: "transform 900ms cubic-bezier(0.55, 0.06, 0.45, 0.94)",
        cursor: interactive ? "pointer" : undefined,
        outline: "none",
      }}
      onClick={interactive ? () => onClick!(agent.agentId) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick!(agent.agentId);
              }
            }
          : undefined
      }
    >
      {/* Selection ring — soft accent halo behind the sprite, sized to
          encompass head + torso. Renders below the body so it reads as
          a glow not a frame. Only shown when the agent panel is anchored
          to this sprite. */}
      {selected && (
        <rect
          x={-4}
          y={-6}
          width={32}
          height={48}
          fill={accent}
          opacity={0.18}
          rx={2}
        />
      )}
      {/* Hit target — invisible rect padded around the sprite so the
          click area feels generous (the painted body is only ~16px wide,
          which is a tiny target). Only present when interactive. */}
      {interactive && (
        <rect x={-4} y={-6} width={32} height={48} fill="transparent" />
      )}
      <CharacterBody
        agent={agent}
        accent={accent}
        skin={skin}
        skinShadow={skinShadow}
        state={state}
      />
      <StateOverlay state={state} atStationCue={atStationCue} />
    </g>
  );
}

// Map station kind → ({verb, stripe}). Lives in character.tsx because
// the speech-bubble copy is a rendering concern, not a layout one.
// Falls back to a generic "working" verb if a future template adds a
// kind we haven't written copy for yet — unknown-kind sprites still
// get a bubble rather than rendering nothing.
function resolveStationCue(
  stationId: string,
  layout: OfficeLayout,
): { verb: string; stripe: string } {
  const positioned = layout.stations.find(
    (s: PositionedStation) => s.station.id === stationId,
  );
  if (!positioned) return { verb: "working", stripe: COL_FOCUS };
  const kind = positioned.station.kind;
  const verb = VERB_BY_STATION_KIND[kind] ?? "working";
  const stripe =
    positioned.station.color ??
    STATION_KIND_STRIPE[kind] ??
    COL_FOCUS;
  return { verb, stripe };
}

const VERB_BY_STATION_KIND: Record<string, string> = {
  monolith: "remembering",
  codex: "reading",
  rack: "filing",
  globe: "searching",
  cabinet: "filing",
  radar: "watching",
  forge: "building",
};

// Mirror of palette KIND_COLORS — duplicated rather than imported so a
// future palette refactor doesn't silently break sprite stripes. Kept
// in sync via the type signature on StationKind.
const STATION_KIND_STRIPE: Record<string, string> = {
  monolith: "#76B8E1",
  codex: "#D9A464",
  rack: "#D9D8C7",
  globe: "#7CB89E",
  cabinet: "#C8B89A",
  radar: "#7CD3C5",
  forge: "#E08D5C",
};

// ---------- Position resolution ----------

interface ResolvedPos {
  x: number;
  y: number;
}

function resolvePosition(
  positioned: PositionedAgent,
  state: AgentState,
  layout: OfficeLayout,
): ResolvedPos | null {
  if (state.kind === "at_station") {
    const station = layout.stations.find(
      (s: PositionedStation) => s.station.id === state.stationId,
    );
    // Unknown stationId → don't render. Better than silently drifting to
    // a default: the dev preview / state panel will show the missing
    // agent and the source of truth (the template) gets fixed.
    if (!station) return null;
    return { x: station.accessX, y: station.accessY };
  }
  // All desk states share one position. The sprite renders before the
  // DeskMonitor pass, which then occludes the torso + legs — so only
  // the head and tops of shoulders read above the monitor. y is offset
  // so the head clears the monitor top by ~2px — close enough that it
  // reads as "working at" not "floating behind."
  return {
    x: positioned.x + (DESK_W - CHAR_W) / 2,
    y: positioned.y - 48,
  };
}

function describeState(state: AgentState): string {
  switch (state.kind) {
    case "idle":
      return "idle at desk";
    case "working":
      return "working";
    case "at_station":
      return `using ${state.stationId}`;
    case "waiting":
      return "waiting";
    case "awaiting_approval":
      return "awaiting your approval";
    case "complete":
      return "complete";
  }
}

// ---------- Body ----------

// All body renderers paint into the same 24×40 box. The parent <g>
// handles the per-agent translate; this component just emits sprite-
// local primitives (coordinates 0..24, 0..40). We always render legs —
// when the agent is at a desk, the DeskMonitor pass covers the torso
// and legs; during walking transitions and at_station, the legs are
// visible.
function CharacterBody({
  agent,
  accent,
  skin,
  skinShadow,
  state,
}: {
  agent: OfficeAgent;
  accent: string;
  skin: string;
  skinShadow: string;
  state: AgentState;
}) {
  return (
    <g>
      <Head
        appearance={agent.appearance}
        accent={accent}
        skin={skin}
        skinShadow={skinShadow}
        state={state}
      />
      <Torso accent={accent} skin={skin} state={state} />
      <Legs state={state} />
    </g>
  );
}

function Head({
  appearance,
  accent,
  skin,
  skinShadow,
  state,
}: {
  appearance: AgentAppearance | undefined;
  accent: string;
  skin: string;
  skinShadow: string;
  state: AgentState;
}) {
  const hairStyle = appearance?.hairStyle ?? "short";
  const facialHair = appearance?.facialHair ?? "none";
  const headwear = appearance?.headwear ?? "none";
  const glasses = appearance?.glasses ?? false;
  const hairAccent = darken(accent, 24); // a touch darker than shirt for legibility against face
  const hairHighlight = accent;

  // Working = head tilted slightly down toward monitor (eyes lower).
  // Waiting = head tilted up (eyes higher, brow raised).
  const eyeY =
    state.kind === "working" ? 9 : state.kind === "waiting" ? 6 : 7;

  // Cap geometry varies by hair style. "bald" suppresses the top hair
  // mass entirely (only side tufts at the temples render). All other
  // styles share the same cap rect so they read as the same vocabulary
  // with different toppings.
  const renderCap = hairStyle !== "bald";

  return (
    <g>
      {/* Skin first — hair / headwear paint over it so the silhouette
          edge is hair, not skin. */}
      <rect x={6} y={3} width={12} height={11} fill={skin} />
      <rect x={16} y={9} width={2} height={3} fill={skinShadow} />

      {renderCap && (
        <>
          {/* Cap top */}
          <rect x={5} y={0} width={14} height={5} fill={hairHighlight} />
          {/* Side temples */}
          <rect x={4} y={2} width={1} height={5} fill={hairHighlight} />
          <rect x={19} y={2} width={1} height={5} fill={hairHighlight} />
          {/* Cap underline shadow so skin doesn't bleed into the cap */}
          <rect x={5} y={5} width={14} height={1} fill={COL_HAIR_SHADOW} />
        </>
      )}

      {hairStyle === "bald" && (
        <>
          {/* Just side tufts — bald top, hair only above the ears. */}
          <rect x={4} y={6} width={2} height={4} fill={hairHighlight} />
          <rect x={18} y={6} width={2} height={4} fill={hairHighlight} />
          {/* A 1-pixel scalp shadow keeps the skin from looking flat. */}
          <rect x={7} y={3} width={10} height={1} fill={skinShadow} />
        </>
      )}

      {hairStyle === "bun" && (
        <>
          {/* 4×3 nub on top — silhouette cue visible even when seated. */}
          <rect x={10} y={-3} width={4} height={3} fill={hairHighlight} />
          <rect x={10} y={0} width={4} height={1} fill={hairAccent} />
        </>
      )}

      {hairStyle === "long" && (
        <>
          {/* Hair runs down past the cap, framing the face and dropping
              onto the shoulders. Reads as long hair from across the room. */}
          <rect x={4} y={5} width={1} height={11} fill={hairHighlight} />
          <rect x={19} y={5} width={1} height={11} fill={hairHighlight} />
          <rect x={3} y={15} width={3} height={2} fill={hairHighlight} />
          <rect x={18} y={15} width={3} height={2} fill={hairHighlight} />
        </>
      )}

      {hairStyle === "fringe" && (
        <>
          {/* Sweep across the forehead — covers half the brow, partial
              coverage of the right eye area. Reads as "swept fringe." */}
          <rect x={6} y={5} width={9} height={1} fill={hairHighlight} />
          <rect x={6} y={6} width={5} height={1} fill={hairHighlight} />
        </>
      )}

      {headwear === "headband" && (
        // 1-pixel band across the brow in a contrasting strip.
        <rect x={5} y={6} width={14} height={1} fill="#E8DCC0" />
      )}

      {headwear === "visor" && (
        <>
          {/* Visor: dark band + brim that extends past the head edge.
              Distinctive silhouette for the scribe role. */}
          <rect x={4} y={5} width={16} height={2} fill="#2A3140" />
          <rect x={2} y={6} width={20} height={1} fill="#1A1F2C" />
        </>
      )}

      {/* Eyes — wrapped so the blink animation hides both at once.
          Glasses, when present, ride on the same eye row. */}
      <g className="co-eyes">
        <rect x={9} y={eyeY} width={2} height={2} fill={COL_EYE} />
        <rect x={13} y={eyeY} width={2} height={2} fill={COL_EYE} />
      </g>
      {glasses && (
        // Frame: 1-pixel ring around each eye + bridge across.
        <g>
          <rect x={8} y={eyeY - 1} width={4} height={1} fill={COL_GLASSES} />
          <rect x={8} y={eyeY + 2} width={4} height={1} fill={COL_GLASSES} />
          <rect x={8} y={eyeY} width={1} height={2} fill={COL_GLASSES} />
          <rect x={11} y={eyeY} width={1} height={2} fill={COL_GLASSES} />
          <rect x={12} y={eyeY - 1} width={4} height={1} fill={COL_GLASSES} />
          <rect x={12} y={eyeY + 2} width={4} height={1} fill={COL_GLASSES} />
          <rect x={12} y={eyeY} width={1} height={2} fill={COL_GLASSES} />
          <rect x={15} y={eyeY} width={1} height={2} fill={COL_GLASSES} />
          {/* Bridge */}
          <rect x={11} y={eyeY} width={2} height={1} fill={COL_GLASSES} />
        </g>
      )}

      {facialHair === "beard" && (
        <>
          {/* Full beard — chin and lower cheeks. */}
          <rect x={7} y={12} width={10} height={2} fill={hairAccent} />
          <rect x={8} y={11} width={8} height={1} fill={hairAccent} />
        </>
      )}
      {facialHair === "stubble" && (
        // Lighter stubble — single 1-pixel band at chin.
        <rect x={8} y={12} width={8} height={1} fill={skinShadow} />
      )}

      {/* Neck */}
      <rect x={10} y={14} width={4} height={2} fill={skin} />
    </g>
  );
}

function Torso({
  accent,
  skin,
  state,
}: {
  accent: string;
  skin: string;
  state: AgentState;
}) {
  // Shoulders narrow → wide so the figure reads "human" not "robot."
  // For at_station and waiting we shift one shoulder forward by 1px to
  // suggest reaching / asking — too subtle to call out, but enough that
  // five sprites in a row don't all sit at attention.
  const leanRight = state.kind === "at_station";
  const leanLeft = state.kind === "waiting";

  return (
    <g>
      {/* Shoulder caps */}
      <rect x={leanLeft ? 2 : 3} y={16} width={2} height={4} fill={accent} />
      <rect x={leanRight ? 21 : 19} y={16} width={2} height={4} fill={accent} />
      {/* Shirt body */}
      <rect x={4} y={16} width={16} height={14} fill={accent} />
      {/* Subtle midline for a centre seam — reads as a torso, not a slab */}
      <rect x={11} y={18} width={2} height={10} fill={shade(accent)} />
      {/* Hands resting / extended */}
      {state.kind === "at_station" ? (
        // One hand reaches out toward the station fixture.
        <>
          <rect x={3} y={26} width={2} height={2} fill={skin} />
          <rect x={20} y={20} width={2} height={2} fill={skin} />
        </>
      ) : state.kind === "waiting" ? (
        // Hand raised — small skin square above the shoulder line.
        <>
          <rect x={3} y={26} width={2} height={2} fill={skin} />
          <rect x={1} y={12} width={2} height={4} fill={accent} />
          <rect x={1} y={11} width={2} height={2} fill={skin} />
        </>
      ) : (
        // Default: hands at the desk plane.
        <>
          <rect x={3} y={26} width={2} height={2} fill={skin} />
          <rect x={19} y={26} width={2} height={2} fill={skin} />
        </>
      )}
    </g>
  );
}

function Legs({ state }: { state: AgentState }) {
  // When the sprite is at_station, give the legs a slow weight-shift
  // stride. Side-effect: also runs through the walking transition since
  // the state class flips at the start of the slide and stays on
  // through arrival, so the slide reads as "walking over."
  const isWalking = state.kind === "at_station";
  return (
    <g className={isWalking ? "co-stride" : undefined}>
      {/* Pants */}
      <rect className="co-leg co-leg-l" x={6} y={30} width={5} height={8} fill={COL_PANTS} />
      <rect className="co-leg co-leg-r" x={13} y={30} width={5} height={8} fill={COL_PANTS} />
      {/* Shoes */}
      <rect className="co-leg co-leg-l" x={6} y={38} width={5} height={2} fill={COL_SHOE} />
      <rect className="co-leg co-leg-r" x={13} y={38} width={5} height={2} fill={COL_SHOE} />
    </g>
  );
}

// ---------- Overlays ----------

// Floats above the head for every state except idle. Coordinates are
// sprite-local — the parent <g> handles per-agent translation, so this
// just pins overlays above the 24×40 sprite box.
//
// at_station overlays need a verb resolved from the layout (Character
// passes that through as `atStationCue`), since the overlay component
// itself doesn't know which station is which.
function StateOverlay({
  state,
  atStationCue,
}: {
  state: AgentState;
  atStationCue: { verb: string; stripe: string } | null;
}) {
  if (state.kind === "at_station" && atStationCue) {
    return <ThoughtBubble verb={atStationCue.verb} stripe={atStationCue.stripe} />;
  }
  if (state.kind === "awaiting_approval") {
    // Envelope above the head + "needs you" verb. Distinct from waiting
    // (thinking…) — the agent is parked on a destructive call that an
    // operator has to approve before the substrate can continue.
    return <ApprovalEnvelopeOverlay />;
  }
  if (state.kind === "waiting") {
    return (
      <g transform="translate(12 -14)">
        <rect x={-9} y={-7} width={18} height={10} fill={COL_BUBBLE} />
        <rect className="co-wait-dot co-wait-dot-1" x={-7} y={-4} width={2} height={2} fill={COL_BUBBLE_INK} />
        <rect className="co-wait-dot co-wait-dot-2" x={-1} y={-4} width={2} height={2} fill={COL_BUBBLE_INK} />
        <rect className="co-wait-dot co-wait-dot-3" x={5} y={-4} width={2} height={2} fill={COL_BUBBLE_INK} />
        {/* Bubble tail pointing back down at the head. */}
        <rect x={-1} y={3} width={2} height={2} fill={COL_BUBBLE} />
        <rect x={0} y={5} width={1} height={1} fill={COL_BUBBLE} />
      </g>
    );
  }
  if (state.kind === "complete") {
    return (
      <g className="co-pop" transform="translate(12 -16)">
        <rect x={-7} y={-7} width={14} height={14} fill={COL_OK_DARK} />
        <rect x={-6} y={-6} width={12} height={12} fill={COL_OK} />
        <rect x={-4} y={-1} width={2} height={2} fill={COL_OK_DARK} />
        <rect x={-2} y={1} width={2} height={2} fill={COL_OK_DARK} />
        <rect x={0} y={-1} width={2} height={2} fill={COL_OK_DARK} />
        <rect x={2} y={-3} width={2} height={2} fill={COL_OK_DARK} />
      </g>
    );
  }
  if (state.kind === "working") {
    // No tool family → "thinking" bubble in the neutral cyan that the
    // pulse-dot used to use. Same shape as a tool-family bubble so the
    // reader's eye doesn't have to switch metaphors mid-glance.
    if (!state.toolFamily) {
      return <ThoughtBubble verb="thinking" stripe={COL_FOCUS} />;
    }
    // Tool family → bubble carrying a 1-word verb. A small family-
    // coloured stripe along the left edge gives a secondary colour cue
    // ("blue stripe + 'remembering'" reads as memory read).
    const verb = VERB_BY_FAMILY[state.toolFamily];
    const stripe = STRIPE_BY_FAMILY[state.toolFamily];
    return <ThoughtBubble verb={verb} stripe={stripe} />;
  }
  // Idle = no overlay. A clean desk reads as "available, nothing on";
  // bubbles are reserved for active states (working / waiting / at_station
  // / awaiting_approval / complete) so the eye finds activity quickly.
  return null;
}

// Verbs are 1-word so the bubble stays narrow enough to fit between
// adjacent desks. Past v1 we may swap these for tool-specific phrases
// ("opening PR" instead of "coding") if telemetry shows certain calls
// are common enough to warrant a custom verb.
const VERB_BY_FAMILY: Record<ToolFamily, string> = {
  memory: "remembering",
  research: "searching",
  cookbook: "reading",
  build: "coding",
  delegate: "delegating",
};

// Family stripe colours — match the corresponding station colour where
// one exists, with violet used for delegate (no station, but the accent
// reads as Ada handing off).
const STRIPE_BY_FAMILY: Record<ToolFamily, string> = {
  memory: "#76B8E1",
  research: "#7CB89E",
  cookbook: "#D9A464",
  build: "#E08D5C",
  delegate: "#C28BD4",
};

// Envelope-style overlay for `awaiting_approval`. Sized to match the
// thought bubble's footprint above the head so the layout reads as
// "the same kind of overhead overlay, but a discrete object" — distinct
// from a verb bubble. Slow pulse to read as "still waiting on you."
function ApprovalEnvelopeOverlay() {
  // Coordinates are sprite-local; parent <g> handles per-agent translate.
  // Box centred over the head: head sits at sprite x=12. Width 24, height 14.
  return (
    <g
      className="co-pulse"
      transform="translate(0 -22)"
      aria-hidden="true"
    >
      {/* Drop shadow for lift off the wall */}
      <rect x={1} y={1} width={24} height={14} fill="#000" opacity={0.35} />
      {/* Envelope body — same warm bubble fill so the kit reads cohesive */}
      <rect x={0} y={0} width={24} height={14} fill={COL_BUBBLE} />
      {/* Flap — diagonal-ish chevron rendered as two stacked rects */}
      <rect x={2} y={1} width={20} height={1} fill={COL_BUBBLE_INK} opacity={0.4} />
      <rect x={4} y={2} width={16} height={1} fill={COL_BUBBLE_INK} opacity={0.55} />
      <rect x={6} y={3} width={12} height={1} fill={COL_BUBBLE_INK} opacity={0.7} />
      <rect x={8} y={4} width={8} height={1} fill={COL_BUBBLE_INK} opacity={0.85} />
      <rect x={10} y={5} width={4} height={1} fill={COL_BUBBLE_INK} />
      {/* Forge-coloured stripe along the bottom — same alarm hue used
          for failed/blocked chips, reinforcing "this needs you." */}
      <rect x={0} y={12} width={24} height={2} fill="#E08D5C" />
      {/* Tail back down at the head */}
      <rect x={11} y={14} width={2} height={1} fill={COL_BUBBLE} />
      <rect x={11.5} y={15} width={1} height={1} fill={COL_BUBBLE} />
    </g>
  );
}

// Thought bubble — fixed-width 60×12 box centered ~17px above the head,
// with a 2-pixel tail pointing back down at the sprite. Pixel-art look
// is preserved by using primitive rects + a single SVG <text> at a
// monospace size that renders crisply at 1x.
//
// Two tones:
//   - "active" (default): full-strength fill, family stripe, accent
//     line on the bottom edge. Used when something is actually
//     happening (working, at_station).
//   - "quiet": dimmed fill, no stripe, no accent line. Used for idle
//     "ready" markers so a quiet desk doesn't drown out an active one.
function ThoughtBubble({
  verb,
  stripe,
  tone = "active",
}: {
  verb: string;
  stripe: string;
  tone?: "active" | "quiet";
}) {
  const w = 60;
  const h = 11;
  const x0 = -w / 2;
  const y0 = -h - 4;
  const quiet = tone === "quiet";
  const bodyOpacity = quiet ? 0.55 : 1;
  const textFill = quiet ? COL_INK_DIM : COL_BUBBLE_INK;
  return (
    <g transform="translate(12 -10)" opacity={quiet ? 0.85 : 1}>
      {/* Subtle drop shadow so the bubble lifts off the wall. Skipped
          in quiet tone to keep the marker visually recessed. */}
      {!quiet && (
        <rect x={x0 + 1} y={y0 + 1} width={w} height={h} fill="#000" opacity={0.35} />
      )}
      {/* Bubble body */}
      <rect x={x0} y={y0} width={w} height={h} fill={COL_BUBBLE} opacity={bodyOpacity} />
      {/* Family stripe — left edge colour cue. Quiet tone omits this so
          the bubble doesn't claim a tool family it isn't using. */}
      {!quiet && (
        <rect x={x0} y={y0} width={2} height={h} fill={stripe} />
      )}
      {/* Bottom-edge accent — active tone only. */}
      {!quiet && (
        <rect x={x0 + 2} y={y0 + h - 1} width={w - 2} height={1} fill={stripe} opacity={0.45} />
      )}
      {/* Tail — 2-pixel chevron pointing down at the head */}
      <rect x={-2} y={y0 + h} width={4} height={1} fill={COL_BUBBLE} opacity={bodyOpacity} />
      <rect x={-1} y={y0 + h + 1} width={2} height={1} fill={COL_BUBBLE} opacity={bodyOpacity} />
      <text
        x={1}
        y={y0 + 8}
        textAnchor="middle"
        fontFamily="var(--font-plex-mono), ui-monospace, monospace"
        fontSize={7}
        fill={textFill}
        style={{ letterSpacing: "0.04em" }}
      >
        {verb}
      </text>
    </g>
  );
}

// ---------- Helpers ----------

// Darken a hex by a fixed amount. Used for shirt seams (32), hair
// accents against face (24), and skin shadows (56). Falls back to the
// hair-shadow constant if the input isn't a 6-digit hex — guards SSR
// from a malformed token without crashing the whole sprite pass.
function darken(hex: string, amount = 32): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return COL_HAIR_SHADOW;
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// Backwards-compat alias for the existing seam call. Kept so the Torso
// renderer's intent ("centre seam = a touch darker than shirt") stays
// readable.
const shade = (hex: string) => darken(hex, 32);
