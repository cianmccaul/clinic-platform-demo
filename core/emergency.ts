/**
 * The emergency redirect (16 Oct 2026): if the Hub has to be pulled, an
 * owner or super admin sends patients from book.northbank.example to Cliniko's own
 * online booking page, so bookings carry on (paid at the clinic, not online).
 *
 * The address is fixed here, not typed in on the dashboard: a stolen staff
 * login must never be able to send patients to a look-alike page. It can be
 * changed in Vercel (EMERGENCY_BOOKING_URL), but only to an https address on
 * cliniko.com. Pure, unit-tested in tests/emergency.test.ts.
 */
export const EMERGENCY_BOOKING_URL = "https://northbank.example-cliniko.com/bookings";

/** Only https pages on Cliniko's own domain. */
export function isAllowedEmergencyUrl(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (host === "cliniko.com" || host.endsWith(".cliniko.com")) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Where patients go in an emergency: EMERGENCY_BOOKING_URL from Vercel if it's a Cliniko page, else the clinic's. */
export function emergencyBookingUrl(env: Record<string, string | undefined>): string {
  const override = env.EMERGENCY_BOOKING_URL?.trim();
  return isAllowedEmergencyUrl(override) ? override! : EMERGENCY_BOOKING_URL;
}

/**
 * ONLINE_BOOKING_ENABLED in Vercel, the switch that works even when Redis or
 * the dashboard doesn't: "false" pauses ("please call"), "redirect" sends
 * patients to Cliniko. Anything else (or unset) leaves it to the dashboard.
 */
export function envBookingMode(value: string | undefined): "paused" | "redirect" | null {
  const v = value?.trim().toLowerCase();
  if (v === "false") return "paused";
  if (v === "redirect") return "redirect";
  return null;
}
