/**
 * New or returning patient, asked first on the booking page (13 Oct 2026).
 * Three answers, kept so the clinic's audits can tell them apart:
 *   new       first visit
 *   returning seen within the last 6 months
 *   lapsed    last seen 6+ months ago (books a new patient appointment)
 * Cliniko names its appointment types by new or return ("Physiotherapy - New
 * Patient", "Osteopathy Return Patients"), so the answer also filters the
 * list: new and lapsed see the new-patient types, returning the return types,
 * and types that don't say (massage, acupuncture) show for everyone.
 * The answer goes on the Cliniko appointment note (visitNote). Pure,
 * unit-tested in tests/patient-kind.test.ts.
 */
export const PATIENT_KINDS = ["new", "returning", "lapsed"] as const;
export type PatientKind = (typeof PATIENT_KINDS)[number];

export const PATIENT_KIND_OPTIONS: { kind: PatientKind; title: string; detail: string }[] = [
  { kind: "new", title: "New patient", detail: "First visit" },
  { kind: "returning", title: "Returning patient", detail: "Seen within the last 6 months" },
  { kind: "lapsed", title: "Returning patient", detail: "Last seen 6+ months ago" },
];

/** Shown once "last seen 6+ months ago" is chosen. */
export const LAPSED_NOTE = "If it has been 6 months or more, you book a new patient appointment.";

export const isPatientKind = (v: unknown): v is PatientKind => typeof v === "string" && (PATIENT_KINDS as readonly string[]).includes(v);

/** Which kind of appointment type this is (by Cliniko's name), or null if it's for everyone. */
export function kindOfType(name: string): "new" | "returning" | null {
  if (/\bnew\s+patients?\b/i.test(name)) return "new";
  if (/\bret(?:urn|urning)\s+patients?\b/i.test(name)) return "returning";
  return null;
}

/** The types a patient who gave this answer can book. */
export function typesFor<T extends { name: string }>(types: T[], kind: PatientKind): T[] {
  const wanted = kind === "returning" ? "returning" : "new";
  return types.filter((t) => {
    const k = kindOfType(t.name);
    return k === null || k === wanted;
  });
}

/** The answer on the appointment note, in the clinic's words. Empty if there isn't a valid one. */
export function visitNote(kind: unknown): string {
  if (!isPatientKind(kind)) return "";
  const what = { new: "New patient, first visit", returning: "Returning patient, seen within the last 6 months", lapsed: "Returning patient, last seen 6+ months ago" }[kind];
  return `Patient type (their answer when booking): ${what}.`;
}
