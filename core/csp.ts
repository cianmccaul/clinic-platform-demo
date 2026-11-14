/**
 * Content Security Policy for the staff dashboard (16 Oct 2026).
 *
 * Patient pages keep the static policy in next.config.mjs (script-src 'self'
 * 'unsafe-inline'), so they stay prerendered and served from the CDN. The
 * dashboard holds the valuable sessions (refunds, staff, the emergency
 * switch), so it gets a strict policy: no inline script runs unless it
 * carries this request's random nonce, and 'strict-dynamic' lets only
 * scripts loaded by those trusted scripts run (Next's chunks, Stripe.js on
 * the phone-booking page). middleware.ts sets it; app/dashboard/layout.tsx
 * renders per request so Next can put the nonce on its own scripts.
 *
 * Pure, unit-tested in tests/csp.test.ts.
 */
export function dashboardCsp(nonce: string, opts: { stripe?: boolean; dev?: boolean } = {}): string {
  const { stripe = false, dev = false } = opts;
  return [
    "default-src 'self'",
    // 'self' and https: are only for old browsers without 'strict-dynamic' (modern ones ignore them).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${stripe ? " https://js.stripe.com" : ""}${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: https:",
    `connect-src 'self'${stripe ? " https://api.stripe.com" : ""}`,
    `frame-src ${stripe ? "https://js.stripe.com https://hooks.stripe.com" : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** A fresh nonce per request: 128 random bits, base64. Works on the Edge runtime. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
