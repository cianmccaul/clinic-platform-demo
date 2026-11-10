"use client";

/**
 * Patches window.fetch so the real screens' /api/... requests are answered
 * by the demo server in the browser. Runs once, when this module loads,
 * before any screen fetches anything. Everything else goes to the network.
 */
import { handle } from "./server";

declare global {
  interface Window {
    __demoFetch?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__demoFetch) {
  window.__demoFetch = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);

    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let body: unknown = undefined;
    const raw = init?.body ?? (input instanceof Request && method !== "GET" ? await input.clone().text() : undefined);
    if (typeof raw === "string" && raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    // A short, realistic pause, so loading states show as they do in production.
    await new Promise((r) => setTimeout(r, method === "GET" ? 120 + Math.random() * 180 : 250 + Math.random() * 250));
    const res =
      handle(method, url, body) ??
      (method === "GET"
        ? { status: 404, json: { error: "This part of the system isn't in the demo." } }
        : { status: 403, json: { error: "Changes on this page aren't part of the demo; it's here to look at. Bookings, appointments, phone bookings, payments and the waitlist all work." } });
    return new Response(JSON.stringify(res.json), { status: res.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
}

export function DemoInstall() {
  return null;
}
