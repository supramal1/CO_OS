"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

const NAV: Array<{ href: string; label: string; adminOnly: boolean }> = [
  { href: "/forge", label: "Dashboard", adminOnly: false },
  { href: "/forge/kanban", label: "Kanban", adminOnly: true },
  { href: "/forge/research-review", label: "Research Review", adminOnly: true },
  { href: "/forge/production-review", label: "Production Review", adminOnly: true },
];

export default function ForgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.isAdmin ?? false;
  const visible = NAV.filter((item) => !item.adminOnly || isAdmin);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <nav
        aria-label="Forge sections"
        style={{
          height: "var(--forge-subnav-h, 44px)",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          padding: "0 28px",
          gap: 4,
          background: "var(--bg)",
        }}
      >
        {visible.map((item) => {
          const active =
            item.href === "/forge"
              ? pathname === "/forge"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
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
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
