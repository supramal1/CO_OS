// Server-side Supabase client for workforce persistence.
//
// Uses the service-role key. RLS is disabled on workforce_* tables — auth
// is enforced at the HTTP route layer (admin-only), so we don't need
// a per-user JWT.
//
// If the service-role key is missing, this returns null and persistence
// degrades to in-memory only (the runner stays usable for dogfood).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function getWorkforceSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (!persistenceWarned) {
      console.warn(
        "[workforce] SUPABASE_SERVICE_ROLE_KEY missing — persistence disabled, falling back to in-memory only.",
      );
      persistenceWarned = true;
    }
    cached = null;
    return cached;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });
  return cached;
}

let persistenceWarned = false;

export function persistenceEnabled(): boolean {
  return getWorkforceSupabase() !== null;
}
