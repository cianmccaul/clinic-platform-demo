/**
 * Find a patient inside "Book a patient by phone" (the answering service, 30 Oct 2026):
 * staff type a surname, a full name, an email or a date of birth, pick the
 * caller, and the booking is made on their existing Cliniko record.
 *
 * Read only, and only what's needed to tell callers apart and fill the
 * booking form: name, date of birth, last and next appointment (date,
 * therapist, treatment). Never notes (only the "GP: …" line the Hub writes
 * itself), files or anything clinical. Reception and owners only, not
 * therapists (PATIENT_LOOKUP_PERMISSION).
 *
 * Cliniko's API can't search by phone number (its patient filters are name,
 * email, date of birth and ids), so a mobile is recognised here but not yet
 * searched. Mobiles are compared as +353 numbers whatever way they were typed.
 *
 * Pure, no I/O; unit-tested in tests/patient-lookup.test.ts.
 */
import type { Permission } from "./roles.ts";
import { toE164 } from "./phone-booking.ts";

export const PATIENT_LOOKUP_PERMISSION: Permission = "phone-booking";
export const MIN_QUERY_LENGTH = 3;
/** Results shown at once: each costs two Cliniko calls (last and next appointment). */
export const MAX_RESULTS = 5;

export type LookupQuery =
  | { kind: "name"; first: string | null; last: string }
  | { kind: "dob"; dateOfBirth: string }
  | { kind: "email"; email: string }
  | { kind: "phone"; mobile: string };

/**
 * A mobile as +353…, from the ways it's written in Cliniko and on the phone:
 * "087 123 4567", "0871234567", "87 123 4567", "353 87 123 4567",
 * "+353 (0)87 123 4567", "00353…". Other countries' numbers in + form are
 * kept. Null for landlines and anything that isn't a phone number.
 */
export function normaliseMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\(0\)/g, "").replace(/[\s().\-/]/g, "");
  if (!/^\+?\d+$/.test(s)) return null;
  if (/^3538\d{8}$/.test(s)) s = `+${s}`;
  else if (/^8\d{8}$/.test(s)) s = `0${s}`;
  else if (/^\+35308\d{8}$/.test(s)) s = `+353${s.slice(5)}`;
  return toE164(s);
}

export const sameMobile = (a: string | null | undefined, b: string | null | undefined) => {
  const x = normaliseMobile(a);
  return !!x && x === normaliseMobile(b);
};

/** "2/4/1958", "02-04-1958", "2 4 1958", "1958-04-02" → "1958-04-02"; null if it isn't a real date. */
export function parseDateOfBirth(raw: string): string | null {
  const s = raw.trim();
  let y: string, m: string, d: string;
  let match = /^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/.exec(s);
  if (match) [, y, m, d] = match;
  else if ((match = /^(\d{1,2})[-/. ]+(\d{1,2})[-/. ]+(\d{4})$/.exec(s))) [, d, m, y] = match;
  else return null;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const date = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/** What staff typed, as one kind of search; null when it's too short to search. */
export function parseLookupQuery(raw: string): LookupQuery | null {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  if (s.length < MIN_QUERY_LENGTH) return null;
  const dob = parseDateOfBirth(s);
  if (dob) return { kind: "dob", dateOfBirth: dob };
  if (s.includes("@")) return { kind: "email", email: s.toLowerCase() };
  if (/^[+\d][\d\s().\-/]*$/.test(s)) {
    const mobile = normaliseMobile(s);
    return mobile ? { kind: "phone", mobile } : null;
  }
  const words = s.split(" ").filter((w) => /\p{L}/u.test(w));
  if (!words.length) return null;
  if (words.length === 1) return { kind: "name", first: null, last: words[0] };
  return { kind: "name", first: words[0], last: words[words.length - 1] };
}

/** Cliniko's q[] filters for a search, or null where Cliniko can't search that way (a phone number). */
export function clinikoFilters(q: LookupQuery): string[] | null {
  // Cliniko's ~ is "contains"; % and _ are its wildcards, so they're taken out of what was typed.
  const clean = (v: string) => v.replace(/[%_]/g, "");
  switch (q.kind) {
    case "name":
      return [`last_name:~${clean(q.last)}`, ...(q.first ? [`first_name:~${clean(q.first)}`] : [])];
    case "dob":
      return [`date_of_birth:=${q.dateOfBirth}`];
    case "email":
      return [`email:=${q.email}`];
    case "phone":
      return null;
  }
}

/** How a search is written in the audit log: the kind of search only, never the name or date typed. */
export const searchKindLabel = (q: LookupQuery) =>
  q.kind === "name" ? (q.first ? "full name" : "surname") : q.kind === "dob" ? "date of birth" : q.kind;

// ---------------------------------------------------------------- results

export type VisitSummary = {
  startsAtISO: string;
  practitionerId: string | null;
  practitionerName: string | null;
  appointmentTypeId: string | null;
  appointmentTypeName: string | null;
};

export type LookupResult = {
  id: string;
  name: string;
  dateOfBirth: string | null;
  last: VisitSummary | null;
  next: VisitSummary | null;
};

/** The booking form's fields, from the Cliniko record. */
export type LookupPrefill = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  address: string;
  county: string;
  eircode: string;
  gpName: string;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
export const linkedId = (x: any): string | null => (x?.links?.self ? String(x.links.self).split("/").pop() || null : null);

/** One appointment, as the lookup shows it. Names from the clinic's own lists. */
export function visitSummary(appt: any, names: { practitioners: Map<string, string>; types: Map<string, string> }): VisitSummary | null {
  if (!appt?.starts_at) return null;
  const practitionerId = linkedId(appt.practitioner);
  const appointmentTypeId = linkedId(appt.appointment_type);
  return {
    startsAtISO: appt.starts_at,
    practitionerId,
    practitionerName: practitionerId ? names.practitioners.get(practitionerId) ?? null : null,
    appointmentTypeId,
    appointmentTypeName: appointmentTypeId ? names.types.get(appointmentTypeId) ?? null : null,
  };
}

/** Attended or still to come: cancelled, deleted and archived appointments don't count. */
export const isLiveAppointment = (a: any) => !a?.cancelled_at && !a?.deleted_at && !a?.archived_at;

export function lookupResult(patient: any, last: VisitSummary | null, next: VisitSummary | null): LookupResult {
  const first = str(patient?.preferred_first_name) || str(patient?.first_name);
  return {
    id: String(patient.id),
    name: [first, str(patient?.last_name)].filter(Boolean).join(" "),
    dateOfBirth: str(patient?.date_of_birth) || null,
    last,
    next,
  };
}

/** Their mobile: the first number marked Mobile, else the first that is one. */
export function mobileOf(patient: any): string {
  const phones: any[] = patient?.patient_phone_numbers ?? [];
  const marked = phones.find((p) => /mobile/i.test(p?.phone_type ?? "") && str(p?.number));
  const any = phones.find((p) => normaliseMobile(p?.number));
  return str((marked ?? any)?.number);
}

/** The GP from the "GP: …" line the Hub writes into the notes (core/patient-details.ts). Nothing else from the notes. */
export function gpNameOf(notes: unknown): string {
  const m = /^GP:\s*(.+)$/m.exec(typeof notes === "string" ? notes : "");
  return m ? m[1].trim().slice(0, 120) : "";
}

export function prefillFrom(patient: any): LookupPrefill {
  return {
    firstName: str(patient?.first_name),
    lastName: str(patient?.last_name),
    email: str(patient?.email),
    phone: mobileOf(patient),
    dateOfBirth: str(patient?.date_of_birth).slice(0, 10),
    address: str(patient?.address_1),
    county: str(patient?.state),
    eircode: str(patient?.post_code),
    gpName: gpNameOf(patient?.notes),
  };
}

/** New / returning / last seen 6+ months ago, from their last appointment (core/patient-kind.ts). */
export function suggestedKind(lastISO: string | null | undefined, now = Date.now()): "returning" | "lapsed" | null {
  if (!lastISO) return null;
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);
  return Date.parse(lastISO) >= sixMonthsAgo.getTime() ? "returning" : "lapsed";
}
