import Link from "next/link";
import { Monogram } from "./monogram";
import { TabNav } from "./tab-nav";
import { UserBadge } from "./user-badge";

export function AppBar() {
  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "var(--shell-h)",
        background: "var(--bg)",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        alignItems: "stretch",
        zIndex: 50,
      }}
    >
      <Link
        href="/cookbook"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 20px",
          borderRight: "1px solid var(--rule)",
          color: "var(--ink)",
        }}
      >
        <Monogram size={18} />
        <span
          style={{
            fontFamily: "var(--font-plex-serif)",
            fontSize: 14,
            fontWeight: 400,
            letterSpacing: "0.01em",
          }}
        >
          Charlie Oscar OS
        </span>
      </Link>

      <TabNav />

      <div style={{ flex: 1 }} />

      <UserBadge />
    </header>
  );
}
