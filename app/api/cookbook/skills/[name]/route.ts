import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  CookbookMcpError,
  deleteSkill,
  getSkill,
  updateSkill,
  type UpdateSkillInput,
} from "@/lib/cookbook-client";

export const dynamic = "force-dynamic";

type RouteParams = { params: { name: string } };

async function requireKey() {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey) {
    return {
      error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    } as const;
  }
  return { session, apiKey: session.apiKey } as const;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireKey();
  if ("error" in auth) return auth.error;
  try {
    const skill = await getSkill(auth.apiKey, params.name);
    return NextResponse.json({ skill });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireKey();
  if ("error" in auth) return auth.error;
  if (!auth.session.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: UpdateSkillInput;
  try {
    body = (await req.json()) as UpdateSkillInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const skill = await updateSkill(auth.apiKey, params.name, body);
    return NextResponse.json({ skill });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireKey();
  if ("error" in auth) return auth.error;
  if (!auth.session.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const result = await deleteSkill(auth.apiKey, params.name);
    return NextResponse.json(result);
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
