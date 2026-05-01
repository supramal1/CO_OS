import { withProfileSession } from "@/lib/profile/profile-route";
import { buildProfileSnapshot } from "@/lib/profile/profile-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  return withProfileSession(async (session) => {
    const profile = await buildProfileSnapshot({
      session,
      apiKey: session.apiKey,
    });
    return { profile };
  });
}
