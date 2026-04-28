"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  NAV_ITEMS,
  moduleById,
  moduleFromPath,
  type ModuleDef,
} from "@/lib/modules";

export function TabNav() {
  const pathname = usePathname();
  const active = moduleFromPath(pathname)?.id;
  const { data: session } = useSession();
  const isAdmin = Boolean(session?.isAdmin);

  return (
    <nav
      style={{ display: "flex", height: "100%", alignItems: "stretch" }}
      aria-label="Modules"
    >
      {NAV_ITEMS.map((item) => {
        if (item.type === "module") {
          const module = moduleById(item.id);
          if (!module || (module.adminOnly && !isAdmin)) return null;
          return (
            <ModuleLink
              key={module.id}
              module={module}
              active={active === module.id}
            />
          );
        }

        const children = item.children
          .map(moduleById)
          .filter(
            (module): module is ModuleDef =>
              module != null && (!module.adminOnly || isAdmin),
          );
        if (children.length === 0) return null;
        const isActive = children.some((module) => module.id === active);
        return (
          <div
            key={item.id}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "stretch",
            }}
          >
            <button
              type="button"
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                padding: "0 18px",
                border: 0,
                background: "transparent",
                fontFamily: "var(--font-plex-sans)",
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: "0.01em",
                color: isActive ? "var(--ink)" : "var(--ink-dim)",
                cursor: "default",
              }}
              aria-haspopup="menu"
              aria-expanded="false"
            >
              {item.label}
              {isActive ? <ActiveBar colour={item.accentVar} /> : null}
            </button>
            <div
              role="menu"
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                minWidth: 190,
                padding: "6px",
                background: "var(--panel)",
                border: "1px solid var(--rule)",
                boxShadow: "0 12px 30px rgba(0, 0, 0, 0.18)",
                display: "none",
              }}
              className="dispatch-menu"
            >
              {children.map((module) => (
                <Link
                  key={module.id}
                  href={module.path}
                  role="menuitem"
                  style={{
                    display: "block",
                    padding: "9px 10px",
                    color: active === module.id ? "var(--ink)" : "var(--ink-dim)",
                    fontFamily: "var(--font-plex-sans)",
                    fontSize: 13,
                    textDecoration: "none",
                    background:
                      active === module.id ? "var(--panel-2)" : "transparent",
                  }}
                  aria-current={active === module.id ? "page" : undefined}
                >
                  {module.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
      <style jsx>{`
        div:hover > .dispatch-menu,
        div:focus-within > .dispatch-menu {
          display: block !important;
        }
      `}</style>
    </nav>
  );
}

function ModuleLink({
  module,
  active,
}: {
  module: ModuleDef;
  active: boolean;
}) {
  return (
    <Link
      href={module.path}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        padding: "0 18px",
        fontFamily: "var(--font-plex-sans)",
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: "0.01em",
        color: active ? "var(--ink)" : "var(--ink-dim)",
        transition: "color 120ms ease",
      }}
      aria-current={active ? "page" : undefined}
    >
      {module.label}
      {active ? <ActiveBar colour={module.accentVar} /> : null}
    </Link>
  );
}

function ActiveBar({ colour }: { colour: string }) {
  return (
    <span
      style={{
        position: "absolute",
        left: 18,
        right: 18,
        bottom: -1,
        height: 2,
        background: colour,
      }}
      aria-hidden
    />
  );
}
