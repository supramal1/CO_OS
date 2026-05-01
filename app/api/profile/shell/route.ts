import { buildProfileShellSnapshot } from "@/lib/profile/profile-snapshot";
import { withProfileSession } from "@/lib/profile/profile-route";

export const dynamic = "force-dynamic";

export async function GET() {
  return withProfileSession((session) => ({
    shell: buildProfileShellSnapshot(session),
  }));
}
