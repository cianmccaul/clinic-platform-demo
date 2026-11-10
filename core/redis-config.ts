/**
 * Which Redis store this deployment uses. Pure, unit-tested in tests/redis-config.test.ts.
 *
 * Production uses the store Vercel's Upstash integration injects (KV_REST_API_*,
 * or UPSTASH_REDIS_REST_* for a store created directly on Upstash).
 *
 * The staging/Preview site must never share it: Redis holds therapist payment
 * routing, so a sandbox test therapist written into the live store would send
 * real patients' payments to a test account. The live store's variables are
 * connected to "All Environments", so Preview gets its own store under a
 * STAGING_ prefix, and a Preview deployment without one gets no Redis at all
 * rather than falling back to the live store.
 */
export type RedisCredentials = { url: string; token: string };

export function redisCredentials(env: Record<string, string | undefined>): RedisCredentials | null {
  const s = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  const stagingUrl = s(env.STAGING_KV_REST_API_URL);
  const stagingToken = s(env.STAGING_KV_REST_API_TOKEN);
  if (stagingUrl && stagingToken) return { url: stagingUrl, token: stagingToken };
  if (env.VERCEL_ENV === "preview") return null;
  const url = s(env.KV_REST_API_URL) ?? s(env.UPSTASH_REDIS_REST_URL);
  const token = s(env.KV_REST_API_TOKEN) ?? s(env.UPSTASH_REDIS_REST_TOKEN);
  return url && token ? { url, token } : null;
}
