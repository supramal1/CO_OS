// Internal dev preview for the pixel office. Renders the default AI Ops
// template (what /workforce ships) plus the Platform Ops demo template,
// stacked, so template portability is visible at a glance. Lives outside
// the /workforce middleware matcher → no auth required.

import { PixelOffice } from "@/components/workforce/office/pixel-office";
import {
  aiOpsTeamTemplate,
  platformOpsTeamTemplate,
} from "@/components/workforce/office/templates";

export const dynamic = "force-static";

export default function OfficeDevPreview() {
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
        Dev preview · pixel office · template portability
      </header>

      <section>
        <Caption>Template — {aiOpsTeamTemplate.name} (default, ships at /workforce)</Caption>
        <PixelOffice template={aiOpsTeamTemplate} />
      </section>

      <section>
        <Caption>Template — {platformOpsTeamTemplate.name} (schema demo)</Caption>
        <PixelOffice template={platformOpsTeamTemplate} />
      </section>
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        marginBottom: 8,
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink-faint)",
      }}
    >
      {children}
    </p>
  );
}
