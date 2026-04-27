import { NextResponse } from "next/server";
import { inflightCount, rosterStatus } from "@/lib/workforce/runner";
import { listPublicAgents } from "@/lib/workforce/agent-info";
import type { HealthResponse } from "@/lib/workforce/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = rosterStatus();
  const agents = listPublicAgents();
  const body: HealthResponse = {
    ok: status.ok,
    rosterValid: status.ok,
    rosterErrors: status.errors.map((e) => ({ code: e.code, message: e.message })),
    leadId: status.leadId,
    agentCount: agents.length,
    substrateVersion: "0.0.1",
    inflightTasks: inflightCount(),
  };
  return NextResponse.json(body, { status: status.ok ? 200 : 503 });
}
