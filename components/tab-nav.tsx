"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { MODULES, moduleFromPath } from "@/lib/modules";

export function TabNav() {
  const pathname = usePathname();
  const active = moduleFromPath(pathname)?.id;
  const { data: session } = useSession();
  const isAdmin = Boolean(session?.isAdmin);

  const visible = MODULES.filter((m) => !m.adminOnly || isAdmin);

  return (
    <nav
      style={{ display: "flex", height: "100%", alignItems: "stretch" }}
      aria-label="Modules"
    >
      {visible.map((m) => {
        const isActive = active === m.id;
        return (
          <Link
            key={m.id}
            href={m.path}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              padding: "0 18px",
              fontFamily: "var(--font-plex-sans)",
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "0.01em",
              color: isActive ? "var(--ink)" : "var(--ink-dim)",
              transition: "color 120ms ease",
            }}
            aria-current={isActive ? "page" : undefined}
          >
            {m.label}
            {isActive && (
              <span
                style={{
                  position: "absolute",
                  left: 18,
                  right: 18,
                  bottom: -1,
                  height: 2,
                  background: m.accentVar,
                }}
                aria-hidden
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
