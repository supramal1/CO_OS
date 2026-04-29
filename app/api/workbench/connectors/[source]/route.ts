import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  WORKBENCH_CONNECTOR_MANAGEMENT_ACTIONS,
  WORKBENCH_MANAGED_CONNECTOR_SOURCES,
  getWorkbenchConnectorManagementStatus,
  isWorkbenchConnectorManagementAction,
  manageWorkbenchConnector,
  normalizeWorkbenchConnectorSource,
  type WorkbenchConnectorManagementResponse,
} from "@/lib/workbench/connector-management";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ source: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const guarded = await guardSource(context);
  if ("response" in guarded) return guarded.response;

  const result = await getWorkbenchConnectorManagementStatus({
    userId: guarded.userId,
    source: guarded.source,
  });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest, context: RouteContext) {
  const guarded = await guardSource(context);
  if ("response" in guarded) return guarded.response;

  let body: { action?: unknown };
  try {
    body = (await req.json()) as { action?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isWorkbenchConnectorManagementAction(body.action)) {
    return NextResponse.json(
      {
        error: "invalid_connector_action",
        allowed: [...WORKBENCH_CONNECTOR_MANAGEMENT_ACTIONS],
      },
      { status: 400 },
    );
  }

  const result = await manageWorkbenchConnector({
    userId: guarded.userId,
    source: guarded.source,
    action: body.action,
    requestUrl: req.url,
  });
  return NextResponse.json(result, { status: responseStatus(result) });
}

async function guardSource(context: RouteContext): Promise<
  | { userId: string; source: NonNullable<ReturnType<typeof normalizeWorkbenchConnectorSource>> }
  | { response: NextResponse }
> {
  const session = await auth();
  if (!session?.principalId) {
    return {
      response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }

  const { source: rawSource } = await context.params;
  const source = normalizeWorkbenchConnectorSource(rawSource);
  if (!source) {
    return {
      response: NextResponse.json(
        {
          error: "invalid_connector_source",
          allowed: [...WORKBENCH_MANAGED_CONNECTOR_SOURCES],
        },
        { status: 400 },
      ),
    };
  }

  return { userId: session.principalId, source };
}

function responseStatus(response: WorkbenchConnectorManagementResponse): number {
  if (response.status === "accepted") return 202;
  if (response.status === "error") return 502;
  if (response.status === "unavailable" && response.action !== "status") {
    return 503;
  }
  return 200;
}
