import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { AdminSubNav } from "@/components/admin-sub-nav";
import { authOptions } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.isAdmin) {
    redirect("/speak-to-charlie");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <AdminSubNav />
      {children}
    </div>
  );
}
