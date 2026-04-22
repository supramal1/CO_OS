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
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--c-forge)",
        }}
      >
        Forge
      </span>
      <h1
        style={{
          fontFamily: "var(--font-plex-serif)",
          fontSize: 36,
          fontWeight: 400,
          color: "var(--ink)",
          maxWidth: 560,
          lineHeight: 1.15,
        }}
      >
        Agents are being built.
      </h1>
      <p
        style={{
          fontFamily: "var(--font-plex-sans)",
          fontSize: 14,
          color: "var(--ink-dim)",
          maxWidth: 440,
          lineHeight: 1.5,
        }}
      >
        Submit a workflow — wired in Forge module step.
      </p>
    </section>
  );
}
