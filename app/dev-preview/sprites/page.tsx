// Sprite states preview. Renders the AI Ops template five times — once
// per AgentState — with a different agent in that state each time, so
// you can eyeball every (agent × state) combination from one page.
//
// Lives outside /workforce so no auth is needed.

import { PixelOffice } from "@/components/workforce/office/pixel-office";
import { aiOpsTeamTemplate } from "@/components/workforce/office/templates";
import type { AgentState } from "@/components/workforce/office/types";

export const dynamic = "force-static";

// Pair every agent with the station kind they'd plausibly use, so the
// at_station previews aren't all hitting Cornerstone.
const AT_STATION_TARGET: Record<string, string> = {
  ada: "cornerstone",
  margaret: "research",
  alan: "drive",
  grace: "drive",
  donald: "cookbook",
};

interface Scenario {
  title: string;
  caption: string;
  states: Record<string, AgentState>;
}

const ALL_WORKING: Record<string, AgentState> = {
  ada: { kind: "working" },
  margaret: { kind: "working" },
  alan: { kind: "working" },
  grace: { kind: "working" },
  donald: { kind: "working" },
};

const SCENARIOS: Scenario[] = [
  {
    title: "All idle (default — empty office)",
    caption:
      "Idle = no overlay. What you see when no tasks are running. The default state when an agent has no entry in the live state map.",
    states: {},
  },
  {
    title: "All working",
    caption:
      "Working = cyan focus dot above the head. Mapped from a running task.",
    states: ALL_WORKING,
  },
  {
    title: "Ada idle · others working",
    caption:
      "Mixed state. Ada has no current task (idle); the four specialists are running tasks (working).",
    states: {
      ...ALL_WORKING,
      ada: { kind: "idle" },
    },
  },
  {
    title: "Margaret at Research · Donald at Cookbook",
    caption:
      "at_station = full-body sprite on the floor in front of the station. Position is the signal — no overlay needed.",
    states: {
      ...ALL_WORKING,
      margaret: { kind: "at_station", stationId: AT_STATION_TARGET.margaret },
      donald: { kind: "at_station", stationId: AT_STATION_TARGET.donald },
    },
  },
  {
    title: "Grace waiting (approval queue)",
    caption:
      "Waiting = cream speech-bubble with three dots. Mapped from `queued` or `blocked` task state.",
    states: {
      ...ALL_WORKING,
      grace: { kind: "waiting" },
    },
  },
  {
    title: "Alan complete · Ada at Cornerstone",
    caption:
      "Two states at once: green checkmark badge (held briefly after completion) + at_station sprite for Ada.",
    states: {
      ...ALL_WORKING,
      alan: { kind: "complete" },
      ada: { kind: "at_station", stationId: AT_STATION_TARGET.ada },
    },
  },
];

export default function SpriteStatesPreview() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <header
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-dim)",
        }}
      >
        Dev preview · sprite states · {aiOpsTeamTemplate.name}
      </header>

      {SCENARIOS.map((scenario) => (
        <section key={scenario.title}>
          <Caption title={scenario.title} body={scenario.caption} />
          <PixelOffice template={aiOpsTeamTemplate} agentStates={scenario.states} />
        </section>
      ))}
    </div>
  );
}

function Caption({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {title}
      </p>
      <p
        style={{
          margin: "4px 0 0",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          color: "var(--ink-dim)",
        }}
      >
        {body}
      </p>
    </div>
  );
}
