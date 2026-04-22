import { AppBar } from "@/components/app-bar";

export default function OsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <AppBar />
      <main
        style={{
          paddingTop: "var(--shell-h)",
          minHeight: "100vh",
          background: "var(--bg)",
        }}
      >
        {children}
      </main>
    </>
  );
}
