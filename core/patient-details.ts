/**
 * The details asked on every booking (clinic decision, 8 Oct 2026): name,
 * address, mobile, email, date of birth, GP, and (optional since 15 Oct)
 * how they heard about us / who referred them, plus the privacy agreement. All are saved to the
 * patient's Cliniko record.
 *
 * Cliniko fields used (docs.api.cliniko.com, Patient):
 *   date_of_birth, address_1, state (county), post_code (Eircode),
 *   patient_phone_numbers (Mobile), referral_source (string, 255),
 *   accepted_privacy_policy, and notes for the GP: Cliniko's own GP field
 *   (referring_doctor_id) needs a Contact record per doctor, so the GP's
 *   name goes in the notes as "GP: …", where staff already look.
 *
 * For a patient Cliniko already has, only empty fields are filled: nothing
 * already there is overwritten or blanked. This booking's answers also go
 * on the appointment note, so a changed GP is still seen.
 *
 * Pure, no I/O; unit-tested in tests/patient-details.test.ts.
 */

export type PatientDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: string; // YYYY-MM-DD
  address?: string;
  county?: string;
  eircode?: string;
  gpName?: string;
  heardAboutUs?: string;
  referredBy?: string;
};

/** The fields a returning patient may be asked for, if Cliniko lacks them. */
export const GAP_FIELDS = ["phone", "dateOfBirth", "address", "gpName", "heardAboutUs"] as const;
export type GapField = (typeof GAP_FIELDS)[number];

const GP_LINE = /^GP:\s*\S/m;
const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;

/** "Referral from a friend or family member — Mary Byrne", trimmed to Cliniko's 255. */
export function referralSourceText(d: Pick<PatientDetails, "heardAboutUs" | "referredBy">) {
  const s = [d.heardAboutUs?.trim(), d.referredBy?.trim()].filter(Boolean).join(" — ");
  return s ? s.slice(0, 255) : undefined;
}

export const gpLine = (gpName?: string) => (has(gpName) ? `GP: ${gpName!.trim()}` : undefined);

/** What Cliniko is missing for this patient, in the order the form asks. */
export function missingDetails(existing: any): GapField[] {
  const out: GapField[] = [];
  if (!(existing?.patient_phone_numbers ?? []).some((p: any) => has(p?.number))) out.push("phone");
  if (!has(existing?.date_of_birth)) out.push("dateOfBirth");
  if (!has(existing?.address_1)) out.push("address");
  if (!GP_LINE.test(existing?.notes ?? "")) out.push("gpName");
  // "How did you hear about us?" is optional (15 Oct), so a returning patient is never asked it again.
  return out;
}

/** Body for POST /patients: everything given, plus the privacy agreement. */
export function newPatientBody(d: PatientDetails, privacyAccepted: boolean) {
  const body: Record<string, unknown> = {
    first_name: d.firstName.trim().slice(0, 50),
    last_name: d.lastName.trim(),
    email: d.email,
  };
  if (has(d.dateOfBirth)) body.date_of_birth = d.dateOfBirth;
  if (has(d.address)) body.address_1 = d.address!.trim();
  if (has(d.county)) body.state = d.county!.trim();
  if (has(d.eircode)) body.post_code = d.eircode!.trim().toUpperCase();
  const ref = referralSourceText(d);
  if (ref) body.referral_source = ref;
  const gp = gpLine(d.gpName);
  if (gp) body.notes = gp;
  if (has(d.phone)) body.patient_phone_numbers = [{ number: d.phone!.trim(), phone_type: "Mobile" }];
  if (privacyAccepted) body.accepted_privacy_policy = true;
  return body;
}

/**
 * PATCH body that fills only what's empty on an existing Cliniko patient.
 * Never includes a field that already has a value, never sends an empty
 * value, so nothing is overwritten or blanked. {} when there's nothing to do.
 */
export function gapFillPatch(existing: any, d: Partial<PatientDetails>, privacyAccepted: boolean) {
  const patch: Record<string, unknown> = {};
  if (!has(existing?.date_of_birth) && has(d.dateOfBirth)) patch.date_of_birth = d.dateOfBirth;
  if (!has(existing?.address_1) && has(d.address)) patch.address_1 = d.address!.trim();
  if (!has(existing?.state) && has(d.county)) patch.state = d.county!.trim();
  if (!has(existing?.post_code) && has(d.eircode)) patch.post_code = d.eircode!.trim().toUpperCase();
  const ref = referralSourceText(d);
  if (!has(existing?.referral_source) && ref) patch.referral_source = ref;
  const phones: any[] = existing?.patient_phone_numbers ?? [];
  if (!phones.some((p) => has(p?.number)) && has(d.phone)) {
    patch.patient_phone_numbers = [{ number: d.phone!.trim(), phone_type: "Mobile" }];
  }
  const notes: string = existing?.notes ?? "";
  const gp = gpLine(d.gpName);
  if (gp && !GP_LINE.test(notes)) patch.notes = notes.trim() ? `${notes.trimEnd()}\n${gp}` : gp;
  if (privacyAccepted && existing?.accepted_privacy_policy !== true) patch.accepted_privacy_policy = true;
  return patch;
}

/** Light checks shared by the form and the server. */
export const isIrishOrIntlMobile = (s: string) => s.replace(/\D/g, "").length >= 7 && s.replace(/\D/g, "").length <= 15;

export function isPlausibleDateOfBirth(s: string, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  const years = (today.getTime() - d.getTime()) / (365.25 * 86_400_000);
  return years >= 0 && years <= 120;
}
