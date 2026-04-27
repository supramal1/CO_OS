import type { NextRequest } from "next/server";

export const DEFAULT_FORGE_NAMESPACE = "default";

function cleanNamespace(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function namespaceFromBody(bodyText?: string | null): string | null {
  if (!bodyText) return null;
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "namespace" in parsed &&
      typeof parsed.namespace === "string"
    ) {
      return cleanNamespace(parsed.namespace);
    }
  } catch {
    return null;
  }
  return null;
}

export function forgeNamespaceFromRequest(
  req: NextRequest,
  bodyText?: string | null,
): string {
  return (
    cleanNamespace(req.nextUrl?.searchParams.get("namespace")) ??
    cleanNamespace(req.headers?.get("x-cornerstone-namespace")) ??
    namespaceFromBody(bodyText) ??
    DEFAULT_FORGE_NAMESPACE
  );
}

export function applyForgeNamespace(
  url: URL,
  req: NextRequest,
  bodyText?: string | null,
) {
  url.searchParams.set("namespace", forgeNamespaceFromRequest(req, bodyText));
}
