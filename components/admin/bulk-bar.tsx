export type BulkAction = {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
};

export function BulkBar({
  selectedCount,
  actions,
  onClear,
  itemNoun = "item",
}: {
  selectedCount: number;
  actions: BulkAction[];
  onClear: () => void;
  itemNoun?: string;
}) {
  if (selectedCount === 0) return null;
  const plural = selectedCount === 1 ? "" : "s";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 28px",
        background: "var(--panel-2)",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          color: "var(--ink)",
        }}
      >
        {selectedCount} {itemNoun}
        {plural} selected
      </span>
      <div style={{ flex: 1 }} />
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={a.onClick}
          disabled={a.disabled}
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            padding: "5px 10px",
            background: "transparent",
            color: a.disabled
              ? "var(--ink-faint)"
              : a.tone === "danger"
                ? "var(--c-forge)"
                : "var(--ink)",
            border: `1px solid ${
              a.tone === "danger" ? "var(--c-forge)" : "var(--rule-2)"
            }`,
            cursor: a.disabled ? "not-allowed" : "pointer",
            opacity: a.disabled ? 0.5 : 1,
          }}
        >
          {a.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.08em",
          padding: "5px 10px",
          background: "transparent",
          color: "var(--ink-dim)",
          border: "none",
          cursor: "pointer",
        }}
      >
        Clear
      </button>
    </div>
  );
}
