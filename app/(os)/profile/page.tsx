import { redirect } from "next/navigation";
import { ProfileShell } from "@/components/profile/profile-shell";
import { buildProfileSnapshot } from "@/lib/profile/profile-snapshot";
import { authWithApiKey } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await authWithApiKey();

  if (!session?.principalId) {
    redirect("/");
  }

  const profile = await buildProfileSnapshot({
    session,
    apiKey: session.apiKey,
  });

  return <ProfileShell initialProfile={profile} />;
}
