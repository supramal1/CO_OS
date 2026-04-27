const MCP_URL = "https://cornerstone-mcp-34862349933.europe-west2.run.app/mcp";

export default function AdminSetupPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Header />

      <div
        style={{
          padding: "28px 28px 48px",
          maxWidth: 760,
          width: "100%",
        }}
      >
        <Intro />

        <Section
          eyebrow="Step 1"
          title="Create a workspace"
          body={
            <>
              <P>
                Open <Code>/admin/workspaces</Code> and click{" "}
                <strong>New workspace</strong>. Pick a type (Client, Internal,
                System), give it a name, and optionally a description. The
                workspace appears in the list immediately.
              </P>
              <P>
                A workspace is the unit of memory isolation. Anything saved
                inside a workspace stays scoped to that workspace.
              </P>
            </>
          }
        />

        <Section
          eyebrow="Step 2"
          title="Add a client connection"
          body={
            <>
              <P>
                Open the workspace detail page (
                <Code>/admin/workspaces/[slug]</Code>) and click{" "}
                <strong>Add member</strong>. Choose the <em>New</em> tab and
                pick a client type:
              </P>
              <Bullets
                items={[
                  <>
                    <strong>Claude Code</strong> — for use from a terminal /
                    repo. Receives an MCP key.
                  </>,
                  <>
                    <strong>Claude Desktop</strong> — for use from the desktop
                    client. Receives an MCP key.
                  </>,
                ]}
              />
              <P>
                A new principal is created and a one-time key is revealed. Copy
                it now — it cannot be recovered.
              </P>
            </>
          }
        />

        <Section
          eyebrow="Step 3"
          title="Connect Claude Code"
          body={
            <>
              <P>
                Open <Code>~/.claude/settings.json</Code> and add the
                Cornerstone entry to <Code>mcpServers</Code>:
              </P>
              <Pre>
                {`{
  "mcpServers": {
    "cornerstone": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer <your-key>",
        "x-cornerstone-namespace": "<workspace-slug>"
      }
    }
  }
}`}
              </Pre>
              <P>
                Restart Claude Code, then verify the connection with a quick
                memory probe (e.g. &ldquo;What do I know about
                &lt;client&gt;?&rdquo;).
              </P>
            </>
          }
        />

        <Section
          eyebrow="Step 4"
          title="Connect Claude Desktop"
          body={
            <>
              <P>
                Open Claude Desktop &rarr; <strong>Settings</strong> &rarr;{" "}
                <strong>Developer</strong> &rarr; <strong>MCP Servers</strong>{" "}
                &rarr; <strong>Add Server</strong>. Enter:
              </P>
              <Pre>
                {`Name: Cornerstone
URL:  ${MCP_URL}
Auth: Bearer <your-key>`}
              </Pre>
              <P>
                Restart Claude Desktop. When prompted for authentication, paste
                the key from Step 2.
              </P>
            </>
          }
        />

        <Section
          eyebrow="Step 5"
          title="Verify access"
          body={
            <>
              <P>
                On the workspace detail page, the new connection should now
                show <strong>active</strong> with its key prefix
                (<Code>csk_…</Code>). Audit events appear in{" "}
                <Code>/admin/audit-log</Code> as the client makes its first
                calls.
              </P>
              <P>
                If a key needs to be rotated, regenerate it from the workspace
                detail page — the old key is revoked atomically and a new key
                is issued.
              </P>
            </>
          }
        />

        <Footer />
      </div>
    </div>
  );
}

function Header() {
  return (
    <header
      style={{
        padding: "20px 28px 16px",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        Admin · setup
      </div>
      <h1
        style={{
          margin: "6px 0 0",
          fontFamily: "var(--font-plex-serif)",
          fontWeight: 400,
          fontSize: 26,
          letterSpacing: "-0.01em",
          color: "var(--ink)",
        }}
      >
        Setup guide
      </h1>
    </header>
  );
}

function Intro() {
  return (
    <p
      style={{
        margin: "0 0 32px",
        fontFamily: "var(--font-plex-sans)",
        fontSize: 15,
        lineHeight: 1.6,
        color: "var(--ink-dim)",
      }}
    >
      How to provision a workspace and wire up a Claude client to read and
      write memory against it. Each step links to a place in the admin module
      where the actual operation happens — this page is reference, not a
      wizard.
    </p>
  );
}

function Section({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <section
      style={{
        padding: "24px 0",
        borderTop: "1px solid var(--rule)",
        display: "flex",
        gap: 32,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 80,
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          paddingTop: 4,
        }}
      >
        {eyebrow}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-plex-serif)",
            fontWeight: 400,
            fontSize: 20,
            letterSpacing: "-0.005em",
            color: "var(--ink)",
          }}
        >
          {title}
        </h2>
        <div
          style={{
            fontFamily: "var(--font-plex-sans)",
            fontSize: 14,
            lineHeight: 1.65,
            color: "var(--ink)",
          }}
        >
          {body}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <div
      style={{
        marginTop: 32,
        padding: "16px 18px",
        borderLeft: "2px solid var(--c-cornerstone)",
        background: "var(--panel-2)",
        fontFamily: "var(--font-plex-sans)",
        fontSize: 13,
        lineHeight: 1.6,
        color: "var(--ink-dim)",
      }}
    >
      Keys are one-time reveal. If you lose a key, regenerate it from the
      workspace detail page — the old one is revoked. Audit history is
      preserved across rotations.
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "0 0 12px" }}>{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 12,
        padding: "1px 5px",
        background: "var(--bg)",
        border: "1px solid var(--rule)",
        color: "var(--ink)",
      }}
    >
      {children}
    </code>
  );
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre
      style={{
        margin: "8px 0 14px",
        padding: "12px 14px",
        background: "var(--bg)",
        border: "1px solid var(--rule)",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 12,
        lineHeight: 1.6,
        color: "var(--ink)",
        overflow: "auto",
        whiteSpace: "pre",
      }}
    >
      {children}
    </pre>
  );
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul
      style={{
        margin: "0 0 12px",
        paddingLeft: 20,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
