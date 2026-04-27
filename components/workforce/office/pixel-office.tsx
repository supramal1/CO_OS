"use client";

// Pixel Office — composer.
//
// Takes an OfficeTemplate (default: aiOpsTeamTemplate) and an optional
// agentStates map (default: every agent idle) and renders a 1024×640
// SVG scene by:
//   1. Running the layout engine to compute desk + station positions.
//   2. Back wall (window + station band + plant shelf).
//   3. Floor.
//   4. Stations via the kind registry.
//   5. Desks (back layer — top, legs, peripherals, nameplate).
//   6. ALL sprites in a single pass.
//   7. Desk monitors (front layer — bezel + screen).
//
// Single sprite pass + back/front desk split is what enables walking:
// each agent's React identity is stable, so when their state flips
// from desk → at_station the CSS transform transition tweens them
// across the floor. Without the desk-back/desk-front split we'd lose
// the "head poking above monitor" silhouette while seated.

import { ACCENT_FALLBACKS, COL_FLOOR, COL_INK_FAINT } from "./palette";
import { H, STATION_ITEM_TOP, W } from "./metrics";
import { Character } from "./character";
import { Desk, DeskMonitor } from "./desk";
import { Floor } from "./floor";
import { InboxBoard } from "./inbox-board";
import { layoutOffice } from "./layout";
import { StationActivePulse } from "./plinth";
import { StationByKind } from "./stations";
import { aiOpsTeamTemplate } from "./templates";
import type { AgentState, OfficeTemplate } from "./types";
import { BackWall } from "./wall";

export interface PixelOfficeProps {
  template?: OfficeTemplate;
  /** Per-agent live state, keyed by agentId. Missing agents default to
   *  "working" — the most common case for an active team. */
  agentStates?: Record<string, AgentState>;
  /** Called when a sprite is clicked. Wiring this up is what turns the
   *  scene into a UI surface — the shell uses it to open a per-agent
   *  panel. When omitted, sprites stay decorative. */
  onAgentClick?: (agentId: string) => void;
  /** Currently-selected agent. Sprite gets a soft accent ring so the
   *  office shows what the open panel is anchored to. */
  selectedAgentId?: string | null;
  /** Pending approval count — drives the inbox board badge + envelopes.
   *  0 renders an "all clear" board; 1+ renders envelopes + a count
   *  badge and turns the board into a button. Click is wired through
   *  `onInboxClick` to the shell. */
  pendingApprovalCount?: number;
  /** Fires when the operator clicks the inbox board. Shell opens the
   *  approval modal in response. */
  onInboxClick?: () => void;
}

export function PixelOffice({
  template = aiOpsTeamTemplate,
  agentStates,
  onAgentClick,
  selectedAgentId,
  pendingApprovalCount = 0,
  onInboxClick,
}: PixelOfficeProps) {
  const layout = layoutOffice(template);

  // Default to idle: an agent with no entry in agentStates has no
  // active task. The dev preview overrides this per-scenario by passing
  // explicit states; the live shell derives states from the polled task
  // list and only writes entries for agents who have tasks.
  const stateFor = (agentId: string): AgentState =>
    agentStates?.[agentId] ?? { kind: "idle" };

  // Build a stationId → visiting-agent map for active-pulse overlays.
  // Multiple agents could in principle visit the same station; v1 picks
  // the first one we encounter and lets the others queue silently.
  // Each entry carries the visiting agent's accent so the pulse takes
  // on their colour ("Margaret is at the globe").
  const stationVisitors: Record<string, string> = {};
  for (const positioned of layout.agents) {
    const state = stateFor(positioned.agent.agentId);
    if (state.kind !== "at_station") continue;
    if (stationVisitors[state.stationId]) continue;
    const accent =
      positioned.agent.accent ??
      ACCENT_FALLBACKS[
        template.agents.indexOf(positioned.agent) % ACCENT_FALLBACKS.length
      ];
    stationVisitors[state.stationId] = accent;
  }

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
        background: "var(--bg)",
        padding: "16px 0",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{
          maxWidth: W,
          height: "auto",
          display: "block",
          imageRendering: "pixelated",
          background: COL_FLOOR,
        }}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`${template.name} pixel office: ${template.agents.length} desks and ${template.stations.length} tool stations.`}
      >
        <SpriteAnimations />
        <BackWall />
        <InboxBoard count={pendingApprovalCount} onClick={onInboxClick} />
        <Floor />
        {layout.stations.map(({ station, x }) => (
          <StationByKind key={station.id} station={station} x={x} />
        ))}
        {/* Active-pulse overlays — rendered after stations so the tinted
            ring sits on top of the static aura. Only renders for stations
            with a current visitor; otherwise empty. */}
        {layout.stations.map(({ station, x }) => {
          const accent = stationVisitors[station.id];
          if (!accent) return null;
          return (
            <StationActivePulse
              key={`pulse-${station.id}`}
              x={x}
              accent={accent}
              itemTop={STATION_ITEM_TOP}
            />
          );
        })}
        {layout.agents.map((positioned) => (
          <Desk key={`desk-${positioned.agent.agentId}`} positioned={positioned} />
        ))}
        {/* Single sprite pass — keys are stable across state changes so
            the CSS transition on transform can tween the slide. */}
        {layout.agents.map((positioned) => (
          <Character
            key={positioned.agent.agentId}
            positioned={positioned}
            state={stateFor(positioned.agent.agentId)}
            layout={layout}
            index={template.agents.indexOf(positioned.agent)}
            onClick={onAgentClick}
            selected={selectedAgentId === positioned.agent.agentId}
          />
        ))}
        {/* Front layer of the desks — only the monitor. Renders after
            sprites so it occludes the torso/legs when the agent is
            seated. The sprite's head sits above the monitor top, so
            heads (and their overlays) stay visible. */}
        {layout.agents.map((positioned) => (
          <DeskMonitor
            key={`monitor-${positioned.agent.agentId}`}
            positioned={positioned}
          />
        ))}
        <CornerStamp templateName={template.name} />
      </svg>
    </div>
  );
}

// Keyframes for sprite animations. Lives inside the SVG so the styles
// scope to this scene — won't leak class collisions onto other SVGs on
// the page. All animations honour `prefers-reduced-motion` by short-
// circuiting to a static end state.
function SpriteAnimations() {
  return (
    <style>{`
      /* Idle blink — eyes vanish for ~120ms every ~5.4s, with a small
         offset so five sprites don't all blink in lockstep. */
      .co-eyes {
        animation: co-blink 5.4s steps(1, end) infinite;
      }
      @keyframes co-blink {
        0%, 96% { opacity: 1; }
        97%, 99% { opacity: 0; }
        100% { opacity: 1; }
      }

      /* Working focus dot — gentle 1.5s pulse, mirrors the "alive but
         calm" rhythm we want for an active task. */
      .co-pulse {
        animation: co-pulse 1.5s ease-in-out infinite;
      }
      @keyframes co-pulse {
        0%, 100% { opacity: 0.55; }
        50% { opacity: 1; }
      }

      /* Waiting bubble dots — staggered fade so the bubble reads as
         "thinking …" rather than three static dots. */
      .co-wait-dot {
        animation: co-wait 1.4s ease-in-out infinite;
      }
      .co-wait-dot-1 { animation-delay: 0s; }
      .co-wait-dot-2 { animation-delay: 0.2s; }
      .co-wait-dot-3 { animation-delay: 0.4s; }
      @keyframes co-wait {
        0%, 60%, 100% { opacity: 0.35; }
        30% { opacity: 1; }
      }

      /* Complete badge — fade-in once on mount. Re-runs whenever the
         badge unmounts/remounts (i.e. each fresh "complete" hold). */
      .co-pop {
        animation: co-pop 0.45s ease-out 1;
        transform-origin: center;
      }
      @keyframes co-pop {
        0%   { opacity: 0; }
        60%  { opacity: 1; }
        100% { opacity: 1; }
      }

      /* Station active pulse — slower, deeper pulse than the working
         dot. Designed to read as "the station is listening to the
         agent that just walked over." Opacity sweeps 0.18 → 0.55 over
         2.4s so the rhythm is recognisably different from the 1.5s
         working-dot pulse. */
      .co-station-pulse {
        opacity: 0.18;
        animation: co-station-pulse 2.4s ease-in-out infinite;
        mix-blend-mode: screen;
      }
      @keyframes co-station-pulse {
        0%, 100% { opacity: 0.18; }
        50% { opacity: 0.55; }
      }

      /* Walking stride — when an agent is at_station the legs do a
         slow weight-shift cycle. Applies to the slide as well, since
         the class is set the moment the state flips, so the sprite
         reads as "walking" while the parent transform tween moves
         them across the floor. */
      .co-stride .co-leg {
        animation: co-leg-step 0.55s steps(2, end) infinite;
      }
      .co-stride .co-leg-l { animation-delay: 0s; }
      .co-stride .co-leg-r { animation-delay: 0.275s; }
      @keyframes co-leg-step {
        0%, 100% { transform: translateY(0); }
        50%      { transform: translateY(-1px); }
      }

      @media (prefers-reduced-motion: reduce) {
        .co-eyes,
        .co-pulse,
        .co-wait-dot,
        .co-pop,
        .co-station-pulse,
        .co-stride .co-leg,
        .co-sprite {
          animation: none;
          transition: none;
        }
        .co-station-pulse { opacity: 0.4; }
      }
    `}</style>
  );
}

function CornerStamp({ templateName }: { templateName: string }) {
  return (
    <text
      x={W - 16}
      y={H - 14}
      textAnchor="end"
      fontFamily="var(--font-plex-mono), ui-monospace, monospace"
      fontSize={9}
      letterSpacing="0.2em"
      fill={COL_INK_FAINT}
      style={{ textTransform: "uppercase" }}
    >
      CO · WORKFORCE · {templateName.toUpperCase()}
    </text>
  );
}
