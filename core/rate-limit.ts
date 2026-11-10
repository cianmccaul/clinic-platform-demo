/**
 * Fixed-window counters for rate limits and attempt caps. Pure: the store
 * is passed in (Redis in production, a Map in tests), and the only store
 * operation is an atomic "increment, starting the window if new", so a
 * burst of concurrent requests can never all slip under the limit.
 */

export type CounterStore = {
  /** Atomically add 1 and return the new count; a new counter expires after ttlSeconds. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Seconds until the counter expires (<= 0 if unknown). */
  ttl(key: string): Promise<number>;
};

export type LimitResult = { ok: true; count: number } | { ok: false; count: number; retryAfterSeconds: number };

export async function hit(store: CounterStore, key: string, limit: number, windowSeconds: number): Promise<LimitResult> {
  const count = await store.incr(key, windowSeconds);
  if (count <= limit) return { ok: true, count };
  const ttl = await store.ttl(key).catch(() => windowSeconds);
  return { ok: false, count, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
}

/** In-memory store with the same atomic semantics, for tests and local dev without Redis. */
export function memoryStore(now: () => number = Date.now): CounterStore {
  const m = new Map<string, { n: number; until: number }>();
  return {
    async incr(key, ttlSeconds) {
      const t = now();
      const cur = m.get(key);
      if (!cur || cur.until <= t) {
        m.set(key, { n: 1, until: t + ttlSeconds * 1000 });
        return 1;
      }
      cur.n += 1;
      return cur.n;
    },
    async ttl(key) {
      const cur = m.get(key);
      return cur ? Math.ceil((cur.until - now()) / 1000) : 0;
    },
  };
}
