/**
 * Runs the demo's fake server inside the browser. Loads the clinic from
 * local storage (or builds a fresh one each day), routes /api/... requests
 * to the handlers, and saves after every change.
 */
import { dublinDay } from "@/core/policy";
import type { Db } from "./db";
import { tick } from "./flows";
import { dispatch } from "./router";
import { seedDb } from "./seed";
import "./routes/patient";
import "./routes/staff";
import "./routes/reception";
import "./routes/money";
import "./routes/waitlist";
import "./routes/readonly";
import "./routes/vouchers";

const KEY = "northbank-demo:v5";
let db: Db | null = null;
const listeners = new Set<() => void>();

function load(now: number): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Db;
      if (saved?.version === 5 && saved.seededFor === dublinDay(new Date(now).toISOString())) return saved;
    }
  } catch {
    /* start fresh */
  }
  return seedDb(now);
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* storage full or blocked: the demo still works for this visit */
  }
  listeners.forEach((l) => l());
}

export function getDb(now = Date.now()): Db {
  if (!db) db = load(now);
  return db;
}

export function resetDemo() {
  db = seedDb(Date.now());
  save();
}

// Another tab (a payment page opened in a new tab, say) changed the demo: pick it up here.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    db = null;
    listeners.forEach((l) => l());
  });
}

export function onDemoChange(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Run a change against the demo data directly (the pretend Stripe page uses this). */
export function withDb<T>(fn: (db: Db, now: number) => T): T {
  const now = Date.now();
  const d = getDb(now);
  tick(d, now);
  const out = fn(d, now);
  save();
  return out;
}

export function handle(method: string, url: URL, body: unknown) {
  const now = Date.now();
  const d = getDb(now);
  tick(d, now);
  try {
    const res = dispatch(d, now, method, url, body);
    if (method !== "GET") save();
    return res;
  } catch (err) {
    console.error("[demo server]", url.pathname, err);
    return { status: 500, json: { error: "Something went wrong in the demo. Try Reset in the demo bar." } };
  }
}
