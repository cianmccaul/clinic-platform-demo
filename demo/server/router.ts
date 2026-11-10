/**
 * The demo's "server": answers the same /api/... requests as production,
 * with the same response shapes, from the browser-side store. Each handler
 * is a short port of the real route in app/api.
 */
import type { Db } from "./db";

export type Req = { method: string; url: URL; body: any; params: Record<string, string> }; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Res = { status?: number; json: unknown };
export type Handler = (db: Db, now: number, req: Req) => Res;

type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };
const routes: Route[] = [];

/** Register a route: path like "/api/rebook/:token". */
export function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), "([^/]+)"))}$`);
  routes.push({ method, pattern, keys, handler });
}

export function dispatch(db: Db, now: number, method: string, url: URL, body: unknown): Res | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = url.pathname.match(r.pattern);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return r.handler(db, now, { method, url, body, params });
  }
  return null;
}

export const ok = (json: unknown): Res => ({ json });
export const fail = (status: number, json: unknown): Res => ({ status, json });
