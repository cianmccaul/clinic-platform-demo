/**
 * Therapists patients can't book online, only by phone through reception
 * (call-by-appointment; issue 2, 3 Nov 2026).
 *
 * Cliniko only gives the Hub free times for practitioners and treatments
 * switched ON for online bookings (its available_times answers 404
 * otherwise, seen live 3 Nov). So these therapists are ON in Cliniko, and
 * the Hub keeps them off everything patients see: the booking site, the
 * waitlist and checkout. Staff booking by phone still see them, marked
 * "Phone only". PHONE_ONLY_PRACTITIONER_IDS (comma-separated) adds more.
 * Pure, unit-tested in tests/phone-only.test.ts.
 */
const BUILT_IN = ["105"]; // Clare Morgan (demo): booked by phone, paid on the clinic's account

export function phoneOnlyIds(env: Record<string, string | undefined> = process.env): Set<string> {
  const extra = (env.PHONE_ONLY_PRACTITIONER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{1,20}$/.test(s));
  return new Set([...BUILT_IN, ...extra]);
}

export const isPhoneOnly = (practitionerId: string | number, env?: Record<string, string | undefined>) => phoneOnlyIds(env).has(String(practitionerId));

/**
 * Can patients book this treatment online? Only if someone who isn't
 * phone-only offers it online. `offering`: Cliniko's practitioners for the type.
 */
export function bookableOnline(offering: { id: string | number; show_in_online_bookings?: boolean }[], env?: Record<string, string | undefined>) {
  return offering.some((p) => p.show_in_online_bookings && !isPhoneOnly(p.id, env));
}
