export default function CookbookPage() {
  return (
    <section
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "grid",
        gridTemplateColumns: "180px minmax(0, 1fr) 320px",
      }}
    >
      <aside
        style={{
          borderRight: "1px solid var(--rule)",
          padding: "20px 16px",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          color: "var(--ink-dim)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        Scope
      </aside>

      <div style={{ padding: "28px 32px", overflow: "auto" }}>
        <h1
          style={{
            fontFamily: "var(--font-plex-serif)",
            fontSize: 28,
            fontWeight: 400,
            color: "var(--ink)",
            marginBottom: 6,
          }}
        >
          Cookbook
        </h1>
        <p
          style={{
            fontFamily: "var(--font-plex-sans)",
            fontSize: 13,
            color: "var(--ink-dim)",
            marginBottom: 24,
          }}
        >
          Repeatable skills for the Charlie Oscar team.
        </p>
        <div
          style={{
            border: "1px solid var(--rule)",
            padding: 40,
            textAlign: "center",
            color: "var(--ink-dim)",
            fontSize: 12,
            fontFamily: "var(--font-plex-mono)",
          }}
        >
          Skills grid — wired in Cookbook module step.
        </div>
      </div>

      <aside
        style={{
          borderLeft: "1px solid var(--rule)",
          padding: "20px 20px",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          color: "var(--ink-dim)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        Detail
      </aside>
    </section>
  );
}
