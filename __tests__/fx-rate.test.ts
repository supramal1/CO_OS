import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// fx-rate.ts is "use client" and uses window.localStorage, so we stage a
// jsdom-lite window/localStorage before importing. Fresh import per test
// clears the module-level singletons nothing, but ensures cache lookups
// start empty between cases.

type StoreShape = Record<string, string>;

function installWindow(store: StoreShape = {}) {
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage };
  return store;
}

async function loadModule() {
  vi.resetModules();
  return import("@/lib/fx-rate");
}

describe("fetchUsdGbpRate", () => {
  beforeEach(() => {
    installWindow();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Tear down the fake window so other tests aren't affected.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;
  });

  it("fetches and returns rate on cache miss", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { GBP: 0.74 }, date: "2026-04-24" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchUsdGbpRate } = await loadModule();
    const result = await fetchUsdGbpRate();
    expect(result).toEqual({ rate: 0.74, date: "2026-04-24" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns cached value without calling fetch when within TTL", async () => {
    const now = Date.now();
    const store = installWindow({
      "co-os-usd-gbp": JSON.stringify({
        rate: 0.74,
        date: "2026-04-24",
        fetchedAt: now,
      }),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { fetchUsdGbpRate } = await loadModule();
    const result = await fetchUsdGbpRate();
    expect(result).toEqual({ rate: 0.74, date: "2026-04-24" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store["co-os-usd-gbp"]).toBeTruthy();
  });

  it("refetches when cache is older than TTL (1h)", async () => {
    const stale = Date.now() - 2 * 60 * 60 * 1000; // 2h ago
    installWindow({
      "co-os-usd-gbp": JSON.stringify({
        rate: 0.5,
        date: "2026-04-01",
        fetchedAt: stale,
      }),
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { GBP: 0.74 }, date: "2026-04-24" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchUsdGbpRate } = await loadModule();
    const result = await fetchUsdGbpRate();
    expect(result).toEqual({ rate: 0.74, date: "2026-04-24" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns null on HTTP error (degrades gracefully)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const { fetchUsdGbpRate } = await loadModule();
    expect(await fetchUsdGbpRate()).toBeNull();
  });

  it("returns null on network throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const { fetchUsdGbpRate } = await loadModule();
    expect(await fetchUsdGbpRate()).toBeNull();
  });

  it("returns null when response is missing GBP rate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: {}, date: "2026-04-24" }),
      }),
    );

    const { fetchUsdGbpRate } = await loadModule();
    expect(await fetchUsdGbpRate()).toBeNull();
  });

  it("treats malformed cache entries as a miss", async () => {
    installWindow({ "co-os-usd-gbp": "{not json" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { GBP: 0.74 }, date: "2026-04-24" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchUsdGbpRate } = await loadModule();
    const result = await fetchUsdGbpRate();
    expect(result).toEqual({ rate: 0.74, date: "2026-04-24" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
