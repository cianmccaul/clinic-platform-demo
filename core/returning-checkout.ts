/**
 * Returning patients skip the details form.
 *
 * Most returning patients' details are already on their record in the diary
 * system, but only people who had paid online before had a saved card, so
 * everyone else typed name, email, mobile, date of birth, address and GP again.
 *
 * Now: the emailed code proves they own the inbox. If exactly one record has
 * that email, they skip the form (only what the record lacks is asked) and pay
 * by card as usual, or with their saved card if they have one. The booking
 * goes onto that record, and its empty fields are filled (never overwritten).
 *
 * Shared (family) emails and emails with no record still get the full form:
 * we couldn't tell whose record the booking is for (core/patient-match.ts).
 *
 * Pure, no I/O; unit-tested in tests/core/returning-checkout.test.ts.
 */
import { missingDetails, type GapField, type PatientDetails } from "./patient-details.ts";
import { prefillFrom } from "./patient-lookup.ts";

/** Payment metadata key for the verified record (set by /api/checkout only, from the code session). */
export const VERIFIED_PATIENT_KEY = "verifiedPatientId";

const RECORD_ID = /^\d{1,20}$/;
const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export type GapAnswers = Partial<Pick<PatientDetails, "phone" | "dateOfBirth" | "address" | "county" | "eircode" | "gpName" | "heardAboutUs" | "referredBy">>;

/**
 * The booking's patient details: name, email and mobile from their record,
 * plus the answers they gave for its gaps. `missing` lists any gap still
 * unanswered (the page asks again); `usable` is false when the record can't
 * be booked onto (archived, deleted, no name or email).
 */
export function verifiedPatientDetails(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  record: any,
  answers: GapAnswers
): { usable: false } | { usable: true; missing: GapField[]; patient: PatientDetails } {
  if (!record || record.archived_at || record.deleted_at) return { usable: false };
  const r = prefillFrom(record);
  if (!has(r.firstName) || !has(r.lastName) || !has(r.email)) return { usable: false };
  const missing = missingDetails(record).filter((f) => !has(answers[f]));
  const patient: PatientDetails = {
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email.trim().toLowerCase(),
    ...(has(answers.phone) ? { phone: answers.phone } : has(r.phone) ? { phone: r.phone } : {}),
    ...pick(answers),
  };
  return { usable: true, missing, patient };
}

function pick(a: GapAnswers): GapAnswers {
  const out: GapAnswers = {};
  for (const k of ["dateOfBirth", "address", "county", "eircode", "gpName", "heardAboutUs", "referredBy"] as const) {
    if (has(a[k])) out[k] = a[k]!.trim();
  }
  return out;
}

/**
 * How the payment webhook finds the patient for a paid checkout. The record
 * id is trusted only from metadata our own server wrote: reception's patient
 * lookup (bookedBy reception) or a verified code session (/api/checkout).
 * Empty fields are filled when we know who the person is: reception on the
 * phone, the waitlist (code-free but staff/patient confirmed), or a code.
 */
export function webhookPatientOptions(meta: Record<string, string | undefined>): { fillGaps: boolean; clinikoPatientId?: string } {
  const verified = RECORD_ID.test(meta[VERIFIED_PATIENT_KEY] ?? "") ? meta[VERIFIED_PATIENT_KEY] : undefined;
  const reception = meta.bookedBy === "reception" && RECORD_ID.test(meta.clinikoPatientId ?? "") ? meta.clinikoPatientId : undefined;
  return {
    fillGaps: meta.bookedBy === "reception" || meta.bookedBy === "waitlist" || !!verified,
    ...(reception ?? verified ? { clinikoPatientId: (reception ?? verified)! } : {}),
  };
}
