import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { createClient } from "@supabase/supabase-js";
import { authOptions } from "@/lib/auth";

// PATCH /api/forge/task-runs/:id/scope
// Reviewer-driven scope edit. Merges the posted fields into
// forge_task_runs.output.scope on the paused pm_orchestration run. The
// backend /resume endpoint reads this same column when it continues, so
// edits saved here are what the Builder receives downstream.
//
// We write directly to Supabase rather than round-tripping through
// cornerstone-api because that repo has no scope-edit endpoint yet.
// When it grows one, this route becomes a thin proxy. Uses the anon key
// because (a) this handler is admin-gated via NextAuth before any DB
// call and (b) forge_task_runs has RLS disabled, same as the read path
// the kanban already uses.

export const dynamic = "force-dynamic";

type ScopeFields = {
  problem?: string;
  approach?: string;
  risks?: string;
  open_questions?: string;
  estimated_effort?: string;
};

const SCOPE_KEYS: ReadonlyArray<keyof ScopeFields> = [
  "problem",
  "approach",
  "risks",
  "open_questions",
  "estimated_effort",
];

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json(
    detail ? { error, detail } : { error },
    { status },
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey) return jsonError(401, "unauthenticated");
  if (!session.isAdmin) return jsonError(403, "admin_only");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return jsonError(500, "supabase_misconfigured");
  }
  const admin = createClient(url, anonKey, {
    auth: { persistSession: false },
  });

  const body = (await req.json().catch(() => ({}))) as ScopeFields;
  const patch: ScopeFields = {};
  for (const key of SCOPE_KEYS) {
    const v = body[key];
    if (typeof v === "string") patch[key] = v;
  }
  if (Object.keys(patch).length === 0) {
    return jsonError(400, "bad_request", "no scope fields supplied");
  }

  // Read current output, merge, write back — the column is a whole-row
  // jsonb so we can't update nested keys atomically without a raw SQL
  // function. Race window is tiny (same reviewer, one open run) and the
  // backend doesn't rewrite output.scope while awaiting_review.
  const { id } = await params;
  const { data: run, error: readErr } = await admin
    .from("forge_task_runs")
    .select("id, output, run_type, stage")
    .eq("id", id)
    .single();
  if (readErr || !run) {
    return jsonError(404, "run_not_found", readErr?.message);
  }
  if (run.run_type !== "pm_orchestration" || run.stage !== "awaiting_review") {
    return jsonError(
      409,
      "not_editable",
      `Run is ${run.run_type} stage=${run.stage}; only pm_orchestration runs awaiting_review can be edited.`,
    );
  }

  const currentOutput = (run.output ?? {}) as { scope?: ScopeFields } & Record<
    string,
    unknown
  >;
  const nextScope = { ...(currentOutput.scope ?? {}), ...patch };
  const nextOutput = { ...currentOutput, scope: nextScope };

  const { error: writeErr } = await admin
    .from("forge_task_runs")
    .update({ output: nextOutput })
    .eq("id", id);
  if (writeErr) {
    return jsonError(500, "write_failed", writeErr.message);
  }

  return NextResponse.json({ scope: nextScope });
}
