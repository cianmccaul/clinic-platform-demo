/**
 * "Take a payment for an appointment that's already happened" (Joan & Cian,
 * 6 Nov 2026). A therapist (or reception, for any therapist) picks one of the
 * therapist's recent Cliniko appointments, checks the email and the amount,
 * and either opens the payment page there and then for the patient, or emails
 * them a link. Pure, no I/O, unit-tested in tests/visit-payment.test.ts.
 *
 * Where the money goes: the therapist's own Stripe account (direct charge,
 * ADR 0006), like any booking. Clare's appointments, and anyone listed in
 * CLINIC_PAID_PRACTITIONER_IDS (comma-separated), are always paid to
 * Northbank's own account, even if one of them is ever onboarded to Stripe.
 */

const CLINIC_PAID_BUILT_IN = ["105"]; // Clare Morgan (clinic owner, demo)

export function clinicPaidIds(env: Record<string, string | undefined> = process.env): Set<string> {
  const extra = (env.CLINIC_PAID_PRACTITIONER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{1,20}$/.test(s));
  return new Set([...CLINIC_PAID_BUILT_IN, ...extra]);
}

/** True when this practitioner's past-appointment payments go to Northbank's own account. */
export const paysClinic = (practitionerId: string | number, env?: Record<string, string | undefined>) => clinicPaidIds(env).has(String(practitionerId));

/** How far back the list goes. */
export const VISIT_LOOKBACK_DAYS = 30;
/** How long an emailed link stays open. */
export const VISIT_LINK_DAYS = 14;
/** Smallest and largest amount one payment can be. */
export const VISIT_MIN_MINOR = 100; // €1
export const VISIT_MAX_MINOR = 100_000; // €1,000

/** Why this amount can't be asked for, or null. */
export function visitAmountRefusal(amountMinor: number): string | null {
  if (!Number.isInteger(amountMinor) || amountMinor < VISIT_MIN_MINOR) return "Enter an amount of at least €1.00.";
  if (amountMinor > VISIT_MAX_MINOR) return "That's more than €1,000. Check the amount, or ask reception.";
  return null;
}

/** Why this appointment can't be paid for here, or null. `nowMs` is the time now. */
export function visitAppointmentRefusal(
  appt: { starts_at?: string | null; cancelled_at?: string | null; deleted_at?: string | null; archived_at?: string | null },
  nowMs: number
): string | null {
  if (!appt.starts_at || Number.isNaN(Date.parse(appt.starts_at))) return "We couldn't find that appointment in Cliniko.";
  if (appt.cancelled_at || appt.deleted_at || appt.archived_at) return "That appointment was cancelled in Cliniko, so it can't be paid for here.";
  const start = Date.parse(appt.starts_at);
  if (start > nowMs) return "That appointment hasn't started yet. For a future appointment, use Book a patient in, or the patient pays online.";
  if (start < nowMs - (VISIT_LOOKBACK_DAYS + 1) * 24 * 60 * 60 * 1000) return `That appointment is more than ${VISIT_LOOKBACK_DAYS} days ago. Ask reception to sort it out.`;
  return null;
}

/** What's suggested: the full price less anything already paid towards the fee through the Hub. */
export function suggestedVisitMinor(priceMinor: number | null, feePaidMinor: number): number | null {
  if (priceMinor == null) return null;
  return Math.max(0, priceMinor - Math.max(0, feePaidMinor));
}

/** "full" for the first payment towards the fee, "balance" once something's been paid. */
export const visitPaymentKind = (feePaidMinor: number): "full" | "balance" => (feePaidMinor > 0 ? "balance" : "full");

/** Turns "65", "65.5", "€65.00" or "65,50" into cents, or null. */
export function parseEuroInput(raw: string): number | null {
  const s = raw.trim().replace(/^€\s*/, "").replace(",", ".");
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** The line added to the appointment's notes in Cliniko once it's paid. */
export function visitPaidNote(o: { amount: string; destination: "clinic" | "therapist"; ref: string; by: string }) {
  const where = o.destination === "therapist" ? "the therapist's Stripe" : "Northbank's Stripe";
  return `Paid after the appointment: ${o.amount} by card (${where}, payment requested by ${o.by}). Stripe ref ${o.ref}`;
}
