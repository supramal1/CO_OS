type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminWorkspaceDetailPage({ params }: PageProps) {
  const { slug } = await params;
  return (
    <div style={{ padding: "32px 28px" }}>
      <p
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-dim)",
          marginBottom: 8,
        }}
      >
        Workspaces / {slug}
      </p>
      <h1
        style={{
          fontFamily: "var(--font-plex-serif)",
          fontWeight: 400,
          fontSize: 32,
          letterSpacing: "-0.01em",
          marginBottom: 12,
        }}
      >
        Workspace detail
      </h1>
      <p
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-dim)",
        }}
      >
        Phase 4 placeholder
      </p>
    </div>
  );
}
