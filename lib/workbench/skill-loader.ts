import "server-only";
import { getSkill, type SkillDetail } from "@/lib/cookbook-client";

type CachedSkill = {
  expiresAt: number;
  skill: SkillDetail;
};

declare global {
  var __workbench_skill_cache: Map<string, CachedSkill> | undefined;
}

const CACHE: Map<string, CachedSkill> =
  (globalThis.__workbench_skill_cache ??= new Map());

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export async function loadWorkbenchSkill(
  apiKey: string,
  name: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<SkillDetail> {
  const key = `${name}:${apiKey}`;
  const now = Date.now();
  const cached = CACHE.get(key);
  if (cached && cached.expiresAt > now) return cached.skill;

  const skill = await getSkill(apiKey, name);
  CACHE.set(key, { skill, expiresAt: now + ttlMs });
  return skill;
}
