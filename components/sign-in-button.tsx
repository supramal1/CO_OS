"use client";

import { signIn } from "next-auth/react";

export function SignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/cookbook" })}
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
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = "var(--ink-dim)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = "var(--rule-2)";
      }}
    >
      Continue with Google
    </button>
  );
}
