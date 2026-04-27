type Tone = "active" | "muted" | "warn" | "danger" | "info";

const TONE_TOKENS: Record<Tone, { fg: string; border: string }> = {
  active: { fg: "var(--ink)", border: "var(--rule-2)" },
  muted: { fg: "var(--ink-dim)", border: "var(--rule)" },
  warn: { fg: "var(--c-cookbook)", border: "var(--c-cookbook)" },
  danger: { fg: "var(--c-forge)", border: "var(--c-forge)" },
  info: { fg: "var(--c-cornerstone)", border: "var(--c-cornerstone)" },
};

const STATUS_TONE: Record<string, Tone> = {
  active: "active",
  pending: "warn",
  claimed: "active",
  revoked: "muted",
  expired: "muted",
  archived: "muted",
  deleted: "danger",
  failed: "danger",
  verified: "active",
};

export function StatusPill({
  status,
  tone,
  label,
}: {
  status?: string;
  tone?: Tone;
  label?: string;
}) {
  const resolvedTone: Tone =
    tone ?? (status ? STATUS_TONE[status.toLowerCase()] ?? "muted" : "muted");
  const display = (label ?? status ?? "").toUpperCase();
  const { fg, border } = TONE_TOKENS[resolvedTone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 18,
        padding: "0 6px",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 9,
        letterSpacing: "0.14em",
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: 1,
        whiteSpace: "nowrap",
      }}
    >
      {display}
    </span>
  );
}
