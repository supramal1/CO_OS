import { buildProfileConnectorsSnapshot } from "@/lib/profile/profile-snapshot";
import { withProfileSession } from "@/lib/profile/profile-route";

export const dynamic = "force-dynamic";

export async function GET() {
  return withProfileSession(async (session) => ({
    connectors: await buildProfileConnectorsSnapshot({ session }),
  }));
}
