import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CORNERSTONE_URL } from "@/lib/cornerstone";
import { applyForgeNamespace } from "@/lib/forge-namespace";
import {
  endpointForTransition,
  isAllowedTransition,
  LANE_ORDER,
  type ForgeLane,
  type ForgeTask,
} from "@/lib/agents-types";

// Proxy endpoint: CO OS is the only caller, so we enforce admin here
// and forward to cornerstone-agents with the right payload shape.
// Cornerstone-agents is currently publicly invokable on Cloud Run;
// if/when it grows API-key auth we forward CORNERSTONE_AGENTS_API_KEY
// as X-API-Key. The backend is authoritative on lane writes — this
// route never PATCHes forge_tasks.lane directly. Lane updates arrive
// at the UI via the Realtime subscription (KR-4) once the agent team
// has done its work.

export const dynamic = "force-dynamic";

const AGENTS_URL =
  process.env.CORNERSTONE_AGENTS_URL ??
  "https://cornerstone-agents-lymgtgeena-nw.a.run.app";

type TransitionBody = {
  from_lane?: unknown;
  to_lane?: unknown;
  confirmation_token?: unknown;
};

type TaskRun = {
  id: string;
  task_id: string;
  run_type: string | null;
  stage: string | null;
  session_id: string | null;
  created_at: string;
};

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json(
    detail ? { error, detail } : { error },
    { status },
  );
}

function agentsHeaders(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const key = process.env.CORNERSTONE_AGENTS_API_KEY;
  if (key) h["X-API-Key"] = key;
  return h;
}

function isForgeLane(v: unknown): v is ForgeLane {
  return typeof v === "string" && (LANE_ORDER as readonly string[]).includes(v);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.apiKey) {
    return jsonError(401, "unauthenticated");
  }
  if (!session.isAdmin) {
    return jsonError(403, "admin_only");
  }

  const taskId = params.id;
  const bodyText = await req.text();
  let body: TransitionBody;
  try {
    body = JSON.parse(bodyText || "{}") as TransitionBody;
  } catch {
    body = {};
  }
  const from = body.from_lane;
  const to = body.to_lane;
  if (!isForgeLane(from) || !isForgeLane(to)) {
    return jsonError(400, "bad_request", "from_lane and to_lane must be valid forge lanes");
  }
  if (!isAllowedTransition(from, to)) {
    return jsonError(
      400,
      "transition_not_allowed",
      `No human-gated transition from ${from} to ${to}. Only backlog→research, research_review→production, and production_review→done are permitted drags.`,
    );
  }

  // Re-read the task so we (a) verify lane still matches the client's
  // from_lane — the Realtime stream may have already moved it — and
  // (b) have title/description/metadata to build the PM brief for invoke.
  const taskUrl = new URL(`${CORNERSTONE_URL}/forge/tasks/${taskId}`);
  applyForgeNamespace(taskUrl, req, bodyText);
  const taskRes = await fetch(taskUrl.toString(), {
    headers: { "X-API-Key": session.apiKey },
    cache: "no-store",
  });
  if (!taskRes.ok) {
    const text = await taskRes.text().catch(() => "");
    return jsonError(
      taskRes.status,
      "task_fetch_failed",
      text || `cornerstone-api returned ${taskRes.status}`,
    );
  }
  const task = (await taskRes.json()) as ForgeTask;
  if (task.lane !== from) {
    return jsonError(
      409,
      "lane_out_of_sync",
      `Task is currently in ${task.lane}, not ${from}. Refresh the board.`,
    );
  }

  const endpoint = endpointForTransition(from, to);
  if (!endpoint) {
    // Guarded by isAllowedTransition above; belt-and-braces.
    return jsonError(500, "no_endpoint_mapping");
  }

  if (endpoint.kind === "invoke") {
    const brief = {
      title: task.title,
      description: task.description ?? "",
      metadata: task.metadata ?? {},
      priority: task.priority,
    };
    const resp = await fetch(`${AGENTS_URL}/invoke`, {
      method: "POST",
      headers: agentsHeaders(),
      body: JSON.stringify({ task_id: taskId, brief }),
    });
    const payload = await resp.text();
    if (!resp.ok) {
      return jsonError(
        resp.status >= 500 ? 502 : resp.status,
        "invoke_failed",
        payload || `cornerstone-agents returned ${resp.status}`,
      );
    }
    return new NextResponse(payload, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resume path — find the paused PM run's session_id. The backend
  // pauses exactly one run per task at a time, so the most recent
  // pm_orchestration row with stage=awaiting_review is unambiguous.
  const runsUrl = new URL(`${CORNERSTONE_URL}/forge/tasks/${taskId}/runs`);
  applyForgeNamespace(runsUrl, req, bodyText);
  const runsRes = await fetch(runsUrl.toString(), {
    headers: { "X-API-Key": session.apiKey },
    cache: "no-store",
  });
  if (!runsRes.ok) {
    const text = await runsRes.text().catch(() => "");
    return jsonError(runsRes.status, "runs_fetch_failed", text);
  }
  const runs = (await runsRes.json()) as TaskRun[];
  const paused = runs.find(
    (r) =>
      r.run_type === "pm_orchestration" &&
      r.stage === "awaiting_review" &&
      r.session_id,
  );
  if (!paused || !paused.session_id) {
    return jsonError(
      409,
      "no_paused_run",
      `Task ${taskId} has no pm_orchestration run paused at awaiting_review — either the backend already advanced the gate, or PM never paused here.`,
    );
  }

  const resp = await fetch(`${AGENTS_URL}/resume`, {
    method: "POST",
    headers: agentsHeaders(),
    body: JSON.stringify({
      session_id: paused.session_id,
      decision: "approved",
      notes: "",
    }),
  });
  const payload = await resp.text();
  if (!resp.ok) {
    return jsonError(
      resp.status >= 500 ? 502 : resp.status,
      "resume_failed",
      payload || `cornerstone-agents returned ${resp.status}`,
    );
  }
  return new NextResponse(payload, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
