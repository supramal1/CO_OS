import { NextResponse } from "next/server";
import { generateNewsroomBrief } from "@/lib/newsroom/brief";
import { authWithApiKey } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await authWithApiKey();
  if (!session?.principalId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const brief = await generateNewsroomBrief({
    userId: session.principalId,
    apiKey: session.apiKey,
  });

  return NextResponse.json(
    { brief },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
