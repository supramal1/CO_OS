type Props = {
  email?: string;
  isAdmin?: boolean;
};

export function UserBadge({
  email = "operator@charlieoscar.com",
  isAdmin = false,
}: Props) {
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
      <span style={{ letterSpacing: "0.02em" }}>{email}</span>
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
      <button
        type="button"
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
