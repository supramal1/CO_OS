export type ProfileCacheClock = () => Date;

export type ProfileCachedState<T> = {
  value: T;
  generatedAt: string;
  lastChecked: string;
  status: "live" | "cached";
};

export type ReadProfileStateCacheInput<T> = {
  key: string;
  load: () => Promise<T>;
  clock?: ProfileCacheClock;
  isUsable?: (value: T) => boolean;
};

type CacheEntry<T> = {
  value: T;
  generatedAt: string;
  lastChecked: string;
};

const profileStateCache = new Map<string, CacheEntry<unknown>>();
const inFlightRefreshes = new Map<string, Promise<void>>();

export async function readProfileStateCache<T>({
  key,
  load,
  clock = () => new Date(),
  isUsable = () => true,
}: ReadProfileStateCacheInput<T>): Promise<ProfileCachedState<T>> {
  const checkedAt = toIso(clock());
  const existing = profileStateCache.get(key) as CacheEntry<T> | undefined;

  if (existing) {
    profileStateCache.set(key, {
      ...existing,
      lastChecked: checkedAt,
    });
    refreshProfileStateCache({ key, load, clock, isUsable, checkedAt });

    return {
      value: existing.value,
      generatedAt: existing.generatedAt,
      lastChecked: checkedAt,
      status: "cached",
    };
  }

  const value = await load();
  const generatedAt = toIso(clock());
  if (isUsable(value)) {
    profileStateCache.set(key, {
      value,
      generatedAt,
      lastChecked: checkedAt,
    });
  }

  return {
    value,
    generatedAt,
    lastChecked: checkedAt,
    status: "live",
  };
}

export function clearProfileStateCache(): void {
  profileStateCache.clear();
  inFlightRefreshes.clear();
}

export function profileStateCacheKey(
  userId: string,
  segment: "connectors" | "personalisation",
): string {
  return `${segment}:${userId}`;
}

function refreshProfileStateCache<T>({
  key,
  load,
  clock,
  isUsable,
  checkedAt,
}: Required<ReadProfileStateCacheInput<T>> & { checkedAt: string }): void {
  if (inFlightRefreshes.has(key)) return;

  const refresh = load()
    .then((value) => {
      if (!isUsable(value)) return;
      profileStateCache.set(key, {
        value,
        generatedAt: toIso(clock()),
        lastChecked: checkedAt,
      });
    })
    .catch(() => {
      const existing = profileStateCache.get(key);
      if (existing) {
        profileStateCache.set(key, {
          ...existing,
          lastChecked: checkedAt,
        });
      }
    })
    .finally(() => {
      inFlightRefreshes.delete(key);
    });

  inFlightRefreshes.set(key, refresh);
}

function toIso(date: Date): string {
  return date.toISOString();
}
