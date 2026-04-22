export default function CornerstonePage() {
  return (
    <section
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "grid",
        gridTemplateColumns: "260px minmax(0, 1fr)",
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
        Threads
      </aside>

      <div style={{ padding: "28px 32px" }}>
        <h1
          style={{
            fontFamily: "var(--font-plex-serif)",
            fontSize: 28,
            fontWeight: 400,
            color: "var(--ink)",
            marginBottom: 6,
          }}
        >
          Cornerstone
        </h1>
        <p
          style={{
            fontFamily: "var(--font-plex-sans)",
            fontSize: 13,
            color: "var(--ink-dim)",
          }}
        >
          Chat with Cornerstone memory — port in Cornerstone module step.
        </p>
      </div>
    </section>
  );
}
