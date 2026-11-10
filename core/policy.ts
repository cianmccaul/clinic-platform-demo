/**
 * Northbank's cancellation policy, shared by the booking form, the patient
 * "manage booking" page and the server routes so they can never disagree.
 *
 * Every online booking is paid in full when it's made (8 Oct 2026).
 * - Cancel or reschedule more than 24 hours ahead: free — the payment is
 *   refunded in full on cancellation, carried over on reschedule.
 * - Cancel within 24 hours: allowed online, but the full appointment fee
 *   applies, so the payment is kept (rule A). Rescheduling within 24 hours
 *   isn't offered online (call the clinic).
 * - No-show: the full fee applies; it's already paid, so nothing more is
 *   charged. Reception or the therapist can waive it by refunding.
 * Older part-paid bookings (the €50 deposit) still have the rest charged to
 * the saved card in both cases.
 */
import { whenLong } from "./format.ts";

export const CANCEL_WINDOW_HOURS = 24;
export const CLINIC_PHONE = "01 555 0100";
export const CLINIC_EMAIL = "hello@northbank.example";
/** tel: link for CLINIC_PHONE in international format. */
export const CLINIC_TEL = `tel:+353${CLINIC_PHONE.replace(/\s+/g, "").replace(/^0/, "")}`;
export const CLINIC_MAP_URL = "https://www.google.com/maps/search/?api=1&query=Northbank%2C+188+Dublin 2+Road%2C+Dublin";

export function hoursUntil(iso: string, now = Date.now()) {
  return (new Date(iso).getTime() - now) / 3_600_000;
}

export function isOutsideCancelWindow(startsAtISO: string, now = Date.now()) {
  return hoursUntil(startsAtISO, now) > CANCEL_WINDOW_HOURS;
}

/**
 * THE cancellation sentence. The booking screens, /manage, the emails and the
 * policy page all use this exact wording (docs/design.md, principle 4), so a
 * patient never reads two versions of the rule. Change it here only.
 */
export const POLICY_SENTENCE =
  `Free to cancel or change until ${CANCEL_WINDOW_HOURS} hours before. ` +
  `After that, or if you miss the appointment, the full appointment fee is charged.`;

/**
 * Extra treatments (clinic, 8 Oct 2026): shockwave, laser and similar are
 * charged on top of the appointment fee, only with the patient's agreement.
 * PLACEHOLDER wording: the clinic is writing the clinic's own sentence for
 * Cliniko's reminders; replace this with it, word for word, so the Hub's
 * screens and emails match Cliniko's. Change it here only.
 */
export const EXTRAS_SENTENCE =
  "If your practitioner suggests an extra treatment, such as shockwave or laser, it's only given if you agree, and it's charged on top of the appointment fee to the card you paid with.";

/**
 * The clinic's "Privacy and Sharing of Information" consent, word for word
 * as used in Jane. The patient must tick "I agree" before paying; the time
 * is recorded in Stripe (privacyAcknowledgedAt).
 */
export const PRIVACY_CONSENT_TITLE = "Privacy and Sharing of Information";

/** The clinic's privacy notice (Cian, 15 Oct). NEXT_PUBLIC_PRIVACY_URL can override it. */
export const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL || "https://northbank.example/privacy/";

/** The privacy checkbox's own words, so a screen reader says what is being agreed to. */
export const PRIVACY_CONSENT_LABEL = "I agree to the privacy and sharing of information above";
export const PRIVACY_CONSENT_TEXT =
  "I authorise the clinic and its associated health professionals to collect my personal and medical information as documented above. " +
  "In addition, I authorise the clinic and its associated health professionals to communicate with my family doctor and/or referring doctor " +
  "as deemed necessary for my beneficial treatment. I also understand that my personal and medical information is confidential and will only " +
  "be disclosed to third parties with my permission.";

/** "Tuesday 13 October, 10:30am" in Irish time (see core/format.ts). */
export function formatDublin(iso: string) {
  return whenLong(iso);
}

export const euro = (minor: number) => `€${(minor / 100).toFixed(2)}`;

/** Euro amount (as Cliniko stores prices) to cents, avoiding float drift. */
export const toMinor = (eur: number) => Math.round(eur * 100);

/** What's still owed against the full price — never negative. */
export function balanceOwedMinor(fullPriceMinor: number, netPaidMinor: number) {
  return Math.max(0, fullPriceMinor - netPaidMinor);
}

/**
 * What happens to the money when a patient cancels online: more than 24h
 * ahead → everything refunded; within 24h → the full fee applies.
 */
export function patientCancelOutcome(startsAtISO: string, now = Date.now()): "refund" | "charge_full" {
  return isOutsideCancelWindow(startsAtISO, now) ? "refund" : "charge_full";
}

// Calendar day in Ireland, e.g. "2026-10-02" — what reception thinks of as "the day".
export const dublinDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/** The UTC instant of midnight at the start of an Irish calendar day ("YYYY-MM-DD"), DST-aware. */
export function dublinMidnightUTC(day: string) {
  const base = Date.parse(`${day}T00:00:00Z`);
  for (const offsetHours of [1, 0]) {
    const t = base - offsetHours * 3_600_000;
    if (dublinDay(new Date(t).toISOString()) === day && dublinDay(new Date(t - 1).toISOString()) !== day) return t;
  }
  return base;
}

/** "YYYY-MM-DD" n days after `day` (calendar arithmetic, no timezone involved). */
export function addDays(day: string, n: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * How far ahead patients can book or move appointments online. Matches
 * Cliniko > Settings > Online bookings > "Offer bookings up to 12 weeks
 * ahead" (checked 4 Nov 2026). Cliniko's setting is what
 * really decides which times exist: change both together.
 */
export const ONLINE_BOOKING_WEEKS_AHEAD = 12;

/** The last Irish date patients can book online, counting from `today`. */
export const lastOnlineBookingDay = (today: string, weeks = ONLINE_BOOKING_WEEKS_AHEAD) => addDays(today, weeks * 7 - 1);

/** The 7-day windows (Irish dates) from `today` out to the online booking limit, for moving a booking week by week. */
export function onlineBookingWeeks(today: string, weeks = ONLINE_BOOKING_WEEKS_AHEAD) {
  return Array.from({ length: weeks }, (_, i) => ({ from: addDays(today, i * 7), to: addDays(today, i * 7 + 6) }));
}

/**
 * Cliniko rejects an availability "from" date in the past (its dates are in
 * the clinic's timezone). Moves `from` up to today (Irish date); null if the
 * whole range is already over.
 */
export function clampAvailabilityRange(from: string, to: string, today: string) {
  const f = from < today ? today : from;
  return to < f ? null : { from: f, to };
}
