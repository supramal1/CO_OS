import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  CookbookMcpError,
  createSkill,
  listSkills,
  type CreateSkillInput,
} from "@/lib/cookbook-client";

export const dynamic = "force-dynamic";

async function requireKey() {
  const session = await auth();
  if (!session?.apiKey) {
    return {
      error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    } as const;
  }
  return { session, apiKey: session.apiKey } as const;
}

export async function GET() {
  const auth = await requireKey();
  if ("error" in auth) return auth.error;
  try {
    const skills = await listSkills(auth.apiKey);
    return NextResponse.json({ skills });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireKey();
  if ("error" in auth) return auth.error;
  if (!auth.session.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: CreateSkillInput;
  try {
    body = (await req.json()) as CreateSkillInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.name || !body.description || !body.scope_type || !body.content) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const skill = await createSkill(auth.apiKey, body);
    return NextResponse.json({ skill });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof CookbookMcpError) {
    return NextResponse.json(
      { error: err.message },
      { status: err.status || 502 },
    );
  }
  const message = err instanceof Error ? err.message : "unknown_error";
  console.error("cookbook_api_error", message);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
