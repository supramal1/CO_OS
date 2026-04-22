import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { CropMarks } from "@/components/crop-marks";
import { Monogram } from "@/components/monogram";
import { SignInButton } from "@/components/sign-in-button";
import { authOptions } from "@/lib/auth";

export default async function SplashPage() {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    redirect("/cookbook");
  }
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
        <SignInButton />
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
