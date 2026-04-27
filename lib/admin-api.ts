/**
 * Browser-side admin fetch. Calls same-origin Next.js proxy at /api/admin/*,
 * which forwards to Cornerstone with the user's per-principal API key. The
 * browser never holds an admin secret directly.
 */
export async function adminFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
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
