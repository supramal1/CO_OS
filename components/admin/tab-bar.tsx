type Tab<T extends string> = {
  id: T;
  label: string;
  count?: number;
};

export function TabBar<T extends string>({
  tabs,
  activeId,
  onChange,
}: {
  tabs: ReadonlyArray<Tab<T>>;
  activeId: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 24,
        borderBottom: "1px solid var(--rule)",
        padding: "0 28px",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(tab.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 0 8px",
              fontFamily: "var(--font-plex-mono)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: active ? "var(--ink)" : "var(--ink-faint)",
              background: "transparent",
              border: "none",
              borderBottom: `1px solid ${
                active ? "var(--ink)" : "transparent"
              }`,
              cursor: "pointer",
              transition: "color 120ms",
            }}
          >
            <span>{tab.label}</span>
            {typeof tab.count === "number" ? (
              <span
                style={{
                  fontSize: 10,
                  color: active ? "var(--ink-dim)" : "var(--ink-faint)",
                }}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
