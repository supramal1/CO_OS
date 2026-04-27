"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WorkspaceSelector } from "@/components/admin/workspace-selector";

const NAV: Array<{ href: string; label: string }> = [
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin/team", label: "Team" },
  { href: "/admin/audit-log", label: "Audit Log" },
  { href: "/admin/setup", label: "Setup" },
];

export function AdminSubNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin sections"
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
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
      <WorkspaceSelector />
    </nav>
  );
}
