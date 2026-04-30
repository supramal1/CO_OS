import { AppBar } from "@/components/app-bar";
import { NewsroomPrefetcher } from "@/components/newsroom/newsroom-prefetcher";

export default function OsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <AppBar />
      <NewsroomPrefetcher />
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
