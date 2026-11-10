/**
 * Cliniko categories that aren't patient care. Room Rentals is for other
 * therapists renting a treatment room (Jane showed it as a separate
 * "FOR THERAPISTS ONLY" location), so it's never listed in the patient
 * booking flow and never takes a deposit. The booking page points
 * therapists to reception instead. Pure, unit-tested in tests/areas.test.ts.
 */
const THERAPIST_ONLY = [/^room rentals?$/i];

/** "2. Room Rentals" → true. Leading staff-ordering numbers are ignored. */
export function isTherapistOnlyCategory(category: string | null | undefined): boolean {
  const name = (category ?? "").replace(/^\d+\.\s*/, "").trim();
  return THERAPIST_ONLY.some((re) => re.test(name));
}
