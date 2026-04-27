"use client";

import { useSession } from "next-auth/react";
import { ResearchReview } from "@/components/forge/research-review";

export default function ResearchReviewPage() {
  const { data: session, status } = useSession();
  if (status === "loading") return <Gate>Loading…</Gate>;
  if (!session?.isAdmin) {
    return <Gate>Research Review is admin-only.</Gate>;
  }
  return <ResearchReview />;
}

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        height: "calc(100vh - var(--shell-h) - var(--forge-subnav-h, 44px))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 40px",
        textAlign: "center",
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-plex-sans)",
          fontSize: 15,
          color: "var(--ink-dim)",
          maxWidth: "44ch",
          lineHeight: 1.55,
        }}
      >
        {children}
      </p>
    </section>
  );
}
