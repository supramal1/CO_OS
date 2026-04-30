"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { PROFILE_PATH } from "@/lib/profile/profile-model";

export function UserBadge() {
  const { data: session, status } = useSession();

  const email = session?.user?.email ?? "—";
  const isAdmin = session?.isAdmin ?? false;
  const loading = status === "loading";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 20px",
        borderLeft: "1px solid var(--rule)",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        color: "var(--ink-dim)",
      }}
    >
      <span style={{ letterSpacing: "0.02em" }}>
        {loading ? "…" : email}
      </span>
      <span
        style={{
          padding: "2px 6px",
          border: `1px solid ${isAdmin ? "var(--c-forge)" : "var(--rule-2)"}`,
          color: isAdmin ? "var(--c-forge)" : "var(--ink-dim)",
          fontSize: 9,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {isAdmin ? "Admin" : "Member"}
      </span>
      <Link
        href={PROFILE_PATH}
        style={{
          fontSize: 11,
          color: "var(--ink-dim)",
          letterSpacing: "0.04em",
        }}
      >
        Profile
      </Link>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        style={{
          fontSize: 11,
          color: "var(--ink-dim)",
          letterSpacing: "0.04em",
        }}
      >
        Sign out
      </button>
    </div>
  );
}
