/**
 * The Hub's three addresses (decision 9 Oct 2026), one deployment:
 *   book.northbank.example       patients: booking, Manage a booking, payment links (NEXT_PUBLIC_APP_URL)
 *   help.northbank.example       public help centre, patient guides       (NEXT_PUBLIC_HELP_URL)
 *   dashboard.northbank.example  staff: one login each                     (NEXT_PUBLIC_DASHBOARD_URL)
 * Until the help/dashboard DNS records exist, both live as paths on the
 * booking site (/help, /dashboard), so nothing waits on DNS. Pure, unit-tested.
 */
type Env = Record<string, string | undefined>;

const clean = (v?: string) => (v && v.trim() ? v.trim().replace(/\/+$/, "") : undefined);

export function appUrl(env: Env): string {
  // Demo: relative links, so the demo works on whatever address it is hosted at.
  return clean(env.NEXT_PUBLIC_APP_URL) ?? "";
}

/** Base URL of the staff dashboard: its own host once set, else {app}/dashboard. */
export function dashboardUrl(env: Env): string {
  return clean(env.NEXT_PUBLIC_DASHBOARD_URL) ?? `${appUrl(env)}/dashboard`;
}

/** Base URL of the public help centre: its own host once set, else {app}/help. */
export function helpUrl(env: Env): string {
  return clean(env.NEXT_PUBLIC_HELP_URL) ?? `${appUrl(env)}/help`;
}

/** Origins the staff sign-in accepts requests from. */
export function staffOrigins(env: Env): string[] {
  const origins = [appUrl(env), clean(env.NEXT_PUBLIC_DASHBOARD_URL)].filter((u): u is string => !!u).map((u) => new URL(u).origin);
  return [...new Set(origins)];
}

/**
 * The passkey "relying party" ID. For any northbank.example address it's the whole
 * domain, so a Face ID set up on book.northbank.example/dashboard keeps working on
 * dashboard.northbank.example, and on later Hub addresses. Changing it would make
 * every saved passkey stop working, so it is fixed here, not configurable.
 */
export function passkeyRpId(env: Env): string {
  const host = new URL(dashboardUrl(env)).hostname;
  if (host === "northbank.example" || host.endsWith(".northbank.example")) return "northbank.example";
  return host; // localhost, or a preview address
}

/**
 * Which part of the Hub a request's host belongs to. Used by middleware.ts to
 * serve the right pages on each address.
 */
export function areaForHost(host: string | null, env: Env): "dashboard" | "help" | "booking" {
  const h = (host ?? "").toLowerCase().split(":")[0];
  const hostOf = (u?: string) => (clean(u) ? new URL(clean(u)!).hostname.toLowerCase() : null);
  if (h && h === hostOf(env.NEXT_PUBLIC_DASHBOARD_URL)) return "dashboard";
  if (h && h === hostOf(env.NEXT_PUBLIC_HELP_URL)) return "help";
  return "booking";
}
