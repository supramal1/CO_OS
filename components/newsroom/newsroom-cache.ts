import type { NewsroomBrief } from "@/lib/newsroom/types";

export const NEWSROOM_BRIEF_CACHE_KEY = "co-os-newsroom-brief-v1";

const NEWSROOM_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedNewsroomBrief = {
  cachedAt: number;
  brief: NewsroomBrief;
};

export function readCachedNewsroomBrief(now = Date.now()): NewsroomBrief | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(NEWSROOM_BRIEF_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedNewsroomBrief>;
    if (!parsed.brief || typeof parsed.cachedAt !== "number") return null;
    if (now - parsed.cachedAt > NEWSROOM_CACHE_TTL_MS) return null;
    return parsed.brief;
  } catch {
    return null;
  }
}

export function writeCachedNewsroomBrief(brief: NewsroomBrief) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      NEWSROOM_BRIEF_CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), brief }),
    );
  } catch {
    // Private browsing or quota limits should not block the live brief.
  }
}
