"use client";

// USD → GBP live rate. LLM APIs bill in USD (forge_task_runs.actual_cost_usd
// is USD) but CO is a UK cost centre so the UI shows GBP primary with USD
// secondary for reference. Frankfurter uses ECB reference rates, updated
// daily, no auth, no rate limits — and CORS-enabled so the browser can
// hit it directly.
const ENDPOINT = "https://api.frankfurter.dev/v1/latest?from=USD&to=GBP";
const CACHE_KEY = "co-os-usd-gbp";
const TTL_MS = 60 * 60 * 1000; // 1h — rate moves <0.5% intra-day

export type FxRate = {
  rate: number; // GBP per 1 USD
  date: string; // rate publication date, YYYY-MM-DD
};

type CacheEntry = FxRate & { fetchedAt: number };

function readCache(): FxRate | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.fetchedAt > TTL_MS) return null;
    if (typeof entry.rate !== "number" || !Number.isFinite(entry.rate)) return null;
    return { rate: entry.rate, date: entry.date };
  } catch {
    return null;
  }
}

function writeCache(rate: FxRate) {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry = { ...rate, fetchedAt: Date.now() };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Quota errors / private mode — ignore, just means we refetch next visit.
  }
}

export async function fetchUsdGbpRate(): Promise<FxRate | null> {
  const cached = readCache();
  if (cached) return cached;
  try {
    const res = await fetch(ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: { GBP?: number }; date?: string };
    const rate = data.rates?.GBP;
    const date = data.date;
    if (typeof rate !== "number" || !Number.isFinite(rate) || !date) return null;
    const result: FxRate = { rate, date };
    writeCache(result);
    return result;
  } catch {
    return null;
  }
}
