import { buildProfilePersonalisationSegmentSnapshot } from "@/lib/profile/profile-snapshot";
import { withProfileSession } from "@/lib/profile/profile-route";

export const dynamic = "force-dynamic";

export async function GET() {
  return withProfileSession(async (session) => {
    const segment = await buildProfilePersonalisationSegmentSnapshot({
      session,
      apiKey: session.apiKey,
    });
    return {
      personalisation: segment.personalisation,
      metadata: segment.metadata,
    };
  });
}
