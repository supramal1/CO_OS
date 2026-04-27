/**
 * Browser-side admin fetch. Calls same-origin Next.js proxy at /api/admin/*,
 * which forwards to Cornerstone with the user's per-principal API key. The
 * browser never holds an admin secret directly.
 */
export type AdminFetchOptions = RequestInit & {
  namespace?: string | null;
};

function withNamespace(path: string, namespace?: string | null) {
  if (!namespace) return path;

  const url = new URL(path, "https://co-os-admin.local");
  if (!url.searchParams.has("namespace")) {
    url.searchParams.set("namespace", namespace);
  }
  return `${url.pathname}${url.search}`;
}

export async function adminFetch<T>(
  path: string,
  options: AdminFetchOptions = {},
): Promise<T> {
  const { namespace, ...init } = options;
  const res = await fetch(`/api${withNamespace(path, namespace)}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      detail?: string;
      error?: string;
    };
    throw new Error(
      err.detail || err.error || `Request failed: ${res.status}`,
    );
  }
  return (await res.json()) as T;
}
