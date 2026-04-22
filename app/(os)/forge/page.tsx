export default function ForgePage() {
  return (
    <section
      style={{
        height: "calc(100vh - var(--shell-h))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 40px",
        textAlign: "center",
        gap: 18,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        Forge
      </span>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-serif)",
          fontSize: 32,
          fontWeight: 400,
          fontStyle: "italic",
          color: "var(--ink)",
          lineHeight: 1.15,
        }}
      >
        Coming soon.
      </h1>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 15,
          color: "var(--ink-dim)",
          maxWidth: "40ch",
          lineHeight: 1.55,
        }}
      >
        Forge agents are being designed. Check back in July.
      </p>
    </section>
  );
}
