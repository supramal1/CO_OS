import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { createClient } from "@supabase/supabase-js";
import { authOptions } from "@/lib/auth";

// GET /api/forge/tasks/:id/pr
// Returns the paused Builder run's PR embed for Production Review.
// Steps:
//   1. Look up the most recent build run with stage=awaiting_review for this task
//   2. Parse owner/repo/number from pr_url (defensive — malformed URLs return 502)
//   3. Fetch GitHub PR details with the server-side token
//   4. Hand back a shape the client can render without knowing GitHub's schema
//
// Cached 30s via Cache-Control — the PR page itself is what the reviewer
// opens for diff/discussion; this embed is a summary strip, so staleness
// up to 30s is fine and keeps us well under GitHub's 5k req/hour limit
// even with a team reviewing in parallel.

export const dynamic = "force-dynamic";

type PrEmbed = {
  run_id: string;
  task_id: string;
  pr_url: string;
  builder_summary: {
    risks?: string;
    tests_run?: string;
    files_changed?: string;
    follow_ups_suggested?: string;
    error?: string;
  } | null;
  submitted_at: string | null;
  pr: {
    title: string;
    state: "open" | "closed" | "draft" | "merged";
    body: string | null;
    additions: number;
    deletions: number;
    changed_files: number;
    commits: number;
    html_url: string;
    head_ref: string;
    base_ref: string;
    author: string | null;
    updated_at: string;
  } | null;
  pr_error: string | null;
};

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json(
    detail ? { error, detail } : { error },
    { status },
  );
}

function parsePrUrl(
  url: string,
): { owner: string; repo: string; number: number } | null {
  // https://github.com/<owner>/<repo>/pull/<number>
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey) return jsonError(401, "unauthenticated");
  if (!session.isAdmin) return jsonError(403, "admin_only");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return jsonError(500, "supabase_misconfigured");

  const sb = createClient(url, anonKey, {
    auth: { persistSession: false },
  });

  const { id } = await params;
  const { data: runs, error } = await sb
    .from("forge_task_runs")
    .select("id, task_id, pr_url, output, completed_at, created_at")
    .eq("task_id", id)
    .eq("run_type", "build")
    .eq("stage", "awaiting_review")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    return jsonError(500, "runs_fetch_failed", error.message);
  }
  const run = runs?.[0];
  if (!run) {
    return jsonError(
      404,
      "no_paused_build_run",
      "Task has no build run paused at awaiting_review — either Builder hasn't opened a PR yet or review already closed.",
    );
  }

  const output = (run.output ?? {}) as {
    summary?: PrEmbed["builder_summary"];
    submitted_at?: string;
    error?: string;
  };

  // When Builder hits budget_exceeded there's still a pr_url in the run
  // row (set before the failure) and output.summary exposes the failure
  // via its own summary.error field. Pass that through so the reviewer
  // knows the PR may be incomplete.
  const builderSummary = output.summary ?? null;

  const base: PrEmbed = {
    run_id: run.id,
    task_id: run.task_id,
    pr_url: run.pr_url ?? "",
    builder_summary: builderSummary,
    submitted_at: output.submitted_at ?? run.completed_at ?? null,
    pr: null,
    pr_error: null,
  };

  if (!run.pr_url) {
    base.pr_error = "Builder run has no pr_url recorded.";
    return NextResponse.json(base, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  const parsed = parsePrUrl(run.pr_url);
  if (!parsed) {
    base.pr_error = `Unrecognised pr_url: ${run.pr_url}`;
    return NextResponse.json(base, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  const ghToken =
    process.env.GITHUB_TOKEN ?? process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!ghToken) {
    base.pr_error = "GITHUB_TOKEN not configured on the server.";
    return NextResponse.json(base, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${ghToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        // Server-side Next.js fetch cache — 30s dedupe across concurrent
        // reviewers hitting the same PR.
        next: { revalidate: 30 },
      },
    );
    if (!ghRes.ok) {
      const text = await ghRes.text().catch(() => "");
      base.pr_error = `GitHub ${ghRes.status}: ${text || "request failed"}`;
    } else {
      const pr = (await ghRes.json()) as {
        title: string;
        state: "open" | "closed";
        draft: boolean;
        merged: boolean;
        body: string | null;
        additions: number;
        deletions: number;
        changed_files: number;
        commits: number;
        html_url: string;
        head: { ref: string };
        base: { ref: string };
        user: { login: string } | null;
        updated_at: string;
      };
      const state: NonNullable<PrEmbed["pr"]>["state"] = pr.merged
        ? "merged"
        : pr.state === "closed"
          ? "closed"
          : pr.draft
            ? "draft"
            : "open";
      base.pr = {
        title: pr.title,
        state,
        body: pr.body,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
        commits: pr.commits,
        html_url: pr.html_url,
        head_ref: pr.head.ref,
        base_ref: pr.base.ref,
        author: pr.user?.login ?? null,
        updated_at: pr.updated_at,
      };
    }
  } catch (err) {
    base.pr_error = err instanceof Error ? err.message : "github fetch failed";
  }

  return NextResponse.json(base, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
