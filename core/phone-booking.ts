/**
 * Rules for bookings reception makes over the phone (clinic decision,
 * 8 Oct 2026). Reception goes through the same five steps as a patient, then
 * the patient pays one of three ways: a link by email, the same link by
 * text, or (once Stripe approves MOTO) their card read out and typed into
 * Stripe's card box. The money always goes to the attending therapist's own
 * Stripe account. Pure, no I/O; unit-tested in tests/phone-booking.test.ts.
 */
import { whenShort, timeShort } from "./format.ts";

/** A payment link holds the slot this long; unpaid, it lapses and frees it. */
export const PAY_LINK_HOLD_SECONDS = 2 * 60 * 60;

/** "rebook": paid, but the time had gone; the payment is kept for another time (lib/rebook.ts). */
export type PayLinkStatus = "pending" | "paid" | "cancelled" | "expired" | "refunded" | "rebook";

/** A link counts as expired once its time is up, whatever was stored. */
export function effectiveStatus(link: { status: PayLinkStatus; expiresAt: string }, now = Date.now()): PayLinkStatus {
  if (link.status === "pending" && Date.parse(link.expiresAt) <= now) return "expired";
  return link.status;
}

/**
 * How long to hold the slot when the link is opened and a Stripe page is
 * made: until the link expires, or until that Stripe page closes if later
 * (Stripe keeps a payment page open for at least 30 minutes).
 */
export function holdSecondsOnOpen(linkExpiresAtISO: string, checkoutTtlSeconds: number, now = Date.now()) {
  const linkLeft = Math.ceil((Date.parse(linkExpiresAtISO) - now) / 1000);
  return Math.max(linkLeft, checkoutTtlSeconds + 60);
}

/**
 * An Irish (or international) mobile number in E.164 for Twilio, or null.
 * "087 123 4567" → "+353871234567"; "+44 7700 900123" → "+447700900123";
 * "00353 87…" → "+35387…". Irish landlines (01…) aren't mobiles, so null.
 */
export function toE164(raw: string): string | null {
  const s = raw.trim().replace(/[\s().-]/g, "");
  let digits: string;
  if (s.startsWith("+")) digits = s.slice(1);
  else if (s.startsWith("00")) digits = s.slice(2);
  else if (/^08\d{8}$/.test(s)) digits = `353${s.slice(1)}`;
  else return null;
  if (!/^\d{8,15}$/.test(digits)) return null;
  if (digits.startsWith("353") && !/^3538\d{8}$/.test(digits)) return null; // Irish, but not a mobile
  return `+${digits}`;
}

/**
 * The text message: the link and the date only, never the treatment or any
 * health detail. The sender is "Northbank" (alphanumeric), which can't take
 * replies, so it says to call.
 */
export function payLinkSms(opts: { url: string; startsAtISO: string; expiresAtISO: string; phone: string }) {
  return (
    `Northbank: please pay for your appointment on ${whenShort(opts.startsAtISO)} here: ${opts.url} ` +
    `The time is held until ${timeShort(opts.expiresAtISO)}. ` +
    `Replies to this number aren't read; call ${opts.phone}.`
  );
}

/**
 * What reception reads to the patient before typing their card in (MOTO).
 * Mirrors the two boxes a patient ticks online.
 */
export function phoneCardScript(opts: { amount: string; policySentence: string; privacyText: string }) {
  return [
    `"Before I take your card: the appointment is ${opts.amount}, paid in full now."`,
    `"${opts.policySentence}"`,
    `"We'll keep your card securely with Stripe, our payment provider, for any extra treatment you agree to on the day and under that policy. Is that OK?"`,
    `"And our privacy agreement: ${opts.privacyText} Do you agree?"`,
    "Wait for a clear yes to both. Then: never write the number down, never read it back, type it only into the Stripe box, and don't take card details on a recorded line.",
  ];
}

/**
 * A therapist books their own patients in (decision 16 Oct 2026): only with
 * themselves, and only by payment link. Reception and owners can book anyone.
 * Returns why not, or null when allowed. Pure, unit-tested.
 */
export function ownBookingRefusal(opts: {
  canBookAnyone: boolean;
  ownPractitionerId: string | null;
  requestedPractitionerId: string;
}): string | null {
  if (opts.canBookAnyone) return null;
  if (!opts.ownPractitionerId) return "Your account isn't linked to your Cliniko diary yet. Ask an owner to link it on Team.";
  if (opts.ownPractitionerId !== opts.requestedPractitionerId) return "You can only book patients in with yourself.";
  return null;
}
