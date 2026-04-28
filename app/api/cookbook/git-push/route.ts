import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { CookbookMcpError, exportVisibleSkills } from "@/lib/cookbook-client";
import { GitPushError, pushExportAsPr } from "@/lib/cookbook-git-push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODULE_JSON = {
  module: "cookbook",
  version: "1.0.0",
  display_name: "Cookbook",
  description:
    "Module 1 of the Charlie Oscar OS. Holds the skills that agents use to do work on brand — writing voice, post structure, tool-use patterns, client-specific idiom. Curated; not every draft is a skill.",
  status: "active",
  scopes_enabled: ["global", "team", "client"],
  contributions_open: false,
  curation_required: true,
  owner: "ai-ops",
  sync: {
    source: "skills/",
    scope_derivation: {
      "global/**": { scope_type: "global", scope_id: null },
      "teams/{team}/**": { scope_type: "team", scope_id: "{team}" },
      "clients/{client}/**": { scope_type: "client", scope_id: "{client}" },
    },
  },
};

export async function POST() {
  const session = await auth();
  if (!session?.apiKey) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const triggeredBy = session.user?.email || "unknown admin";

  try {
    const raw = await exportVisibleSkills(session.apiKey);
    const payload = { ...raw, module: MODULE_JSON };
    const result = await pushExportAsPr(payload, triggeredBy);
    return NextResponse.json({
      pr_url: result.prUrl,
      pr_number: result.prNumber,
      branch: result.branch,
      commit_sha: result.commitSha,
      file_count: result.fileCount,
      skill_count: payload.count,
    });
  } catch (err) {
    if (err instanceof GitPushError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof CookbookMcpError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status || 502 },
      );
    }
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("cookbook_git_push_error", message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
