/**
 * Which Cliniko patient a booking belongs to.
 *
 * Families often share one email in Cliniko (668 shared addresses found in
 * the 25 Oct 2026 audit: a parent's email on their children's records, two
 * partners on one inbox). Matching on email alone could put a booking, its
 * payment and its intake answers on the wrong person's clinical record. So a
 * record counts as the same patient only when the email AND the name match:
 *
 * - surname must match (accents, apostrophes, hyphens and spaces ignored:
 *   "O'Brien" = "OBrien" = "O Brien", "Kowalská" = "Kowalska");
 * - first name must match the record's first or preferred first name, or
 *   share its first word ("Mary Anne" = "Mary");
 * - a date of birth, when both sides have one, must agree (a father and son
 *   with the same name and email are two people).
 *
 * No match means a new patient record (same email). That can make a
 * duplicate when someone books under a nickname; a duplicate can be merged,
 * a booking on someone else's record is a clinical and privacy problem.
 * Pure, no I/O, unit-tested in tests/patient-match.test.ts.
 */

export type MatchCandidate = {
  id: string | number;
  first_name?: string | null;
  last_name?: string | null;
  preferred_first_name?: string | null;
  date_of_birth?: string | null;
};

export type MatchWanted = { firstName: string; lastName: string; dateOfBirth?: string | null };

export function normaliseNamePart(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[łŁ]/g, "l")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[-.,_]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const surnameKey = (s: string | null | undefined) => normaliseNamePart(s).replace(/ /g, "");

export function firstNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normaliseNamePart(a);
  const y = normaliseNamePart(b);
  if (!x || !y) return false;
  return x === y || x.split(" ")[0] === y.split(" ")[0];
}

const dob = (s: string | null | undefined) => (s ?? "").trim().slice(0, 10);

/** True when this record is the person described by `wanted`. */
export function isSamePerson(c: MatchCandidate, wanted: MatchWanted): boolean {
  const last = surnameKey(wanted.lastName);
  if (!last || surnameKey(c.last_name) !== last) return false;
  if (!firstNamesMatch(c.first_name, wanted.firstName) && !firstNamesMatch(c.preferred_first_name, wanted.firstName)) return false;
  const a = dob(c.date_of_birth);
  const b = dob(wanted.dateOfBirth);
  return !(a && b && a !== b);
}

/**
 * The record among those sharing an email that is this person, or null.
 * Several records for the same person (old duplicates): one with the same
 * date of birth first, otherwise Cliniko's order (oldest first).
 * `sharedEmail` is true when other people's records use the same email.
 */
export function matchPatient<T extends MatchCandidate>(
  candidates: T[],
  wanted: MatchWanted
): { patient: T | null; sharedEmail: boolean } {
  const same = candidates.filter((c) => isSamePerson(c, wanted));
  const wantedDob = dob(wanted.dateOfBirth);
  const ranked = wantedDob ? [...same].sort((a, b) => Number(dob(b.date_of_birth) === wantedDob) - Number(dob(a.date_of_birth) === wantedDob)) : same;
  const patient = ranked[0] ?? null;
  const sharedEmail = candidates.some((c) => !same.includes(c));
  return { patient, sharedEmail };
}

/** Appointment note when a new record was made although the email was already on file. */
export const SHARED_EMAIL_NOTE =
  "This email is also on another patient's record in Cliniko (often a family member). The name didn't match, so the Hub made a new record. If this is the same person under a different name, merge the two records.";
