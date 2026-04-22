import { CropMarks } from "@/components/crop-marks";
import { Monogram } from "@/components/monogram";

export default function SplashPage() {
  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--ink)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <CropMarks />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
          textAlign: "center",
        }}
      >
        <Monogram size={44} />
        <h1
          style={{
            fontFamily: "var(--font-plex-serif)",
            fontWeight: 400,
            fontSize: 48,
            letterSpacing: "-0.01em",
          }}
        >
          Charlie Oscar OS
        </h1>
        <p
          style={{
            fontFamily: "var(--font-plex-sans)",
            fontSize: 13,
            color: "var(--ink-dim)",
            maxWidth: 360,
            lineHeight: 1.55,
          }}
        >
          The operating system for Charlie Oscar. Sign in with your work account to continue.
        </p>
        <button
          type="button"
          style={{
            marginTop: 8,
            border: "1px solid var(--rule-2)",
            padding: "12px 22px",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ink)",
            transition: "background 120ms ease, border-color 120ms ease",
          }}
        >
          Continue with Google
        </button>
      </div>

      <span
        style={{
          position: "absolute",
          right: 28,
          bottom: 28,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.18em",
          color: "var(--ink-faint)",
        }}
      >
        CO-OS / V1.0
      </span>
    </div>
  );
}
