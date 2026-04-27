"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function WorkforceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <nav
        aria-label="Workforce sections"
        style={{
          height: 44,
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          padding: "0 28px",
          gap: 4,
          background: "var(--bg)",
        }}
      >
        <Link
          href="/workforce"
          style={navLinkStyle(pathname === "/workforce")}
        >
          Dispatch
        </Link>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
          }}
        >
          v0 functional · pixel office Phase 1
        </span>
      </nav>
      {children}
    </div>
  );
}

function navLinkStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-plex-mono)",
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    padding: "6px 10px",
    background: active ? "var(--ink)" : "transparent",
    color: active ? "var(--panel)" : "var(--ink-dim)",
    border: "1px solid",
    borderColor: active ? "var(--ink)" : "var(--rule)",
    textDecoration: "none",
  };
}
