import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { CookbookMcpError, exportVisibleSkills } from "@/lib/cookbook-client";

export const dynamic = "force-dynamic";

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

  try {
    const payload = await exportVisibleSkills(session.apiKey);
    return NextResponse.json({ ...payload, module: MODULE_JSON });
  } catch (err) {
    if (err instanceof CookbookMcpError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status || 502 },
      );
    }
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("cookbook_export_error", message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
