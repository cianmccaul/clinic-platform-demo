/**
 * Charge a returning patient's saved card from "Book a patient by phone"
 * (the answering service, 30 Oct 2026; plan step 3). Only for a patient picked in the
 * patient lookup, only with a card already saved on the account the chosen
 * therapist is paid into (a card saved with one therapist can't be used for
 * another, 6 Oct), and only after staff tick that the patient agreed on this
 * call to pay this amount for this appointment. The card was saved under "I
 * authorise Northbank to … charge it … for future bookings I make" (confirmed
 * by Cian, 30 Oct 2026). Not MOTO (decision 20 Oct): an off-session charge of
 * the saved card, as for extras.
 *
 * If the bank wants the patient to approve it, the same payment is kept and
 * the patient is emailed a link to approve it (lib/approvals.ts); the time
 * stays held and it's booked once approved. Only if they can't approve it,
 * the link expires, or the card is declined do staff get "Send a payment link
 * instead", with the reason in plain words.
 *
 * Pure, no I/O; unit-tested in tests/phone-saved-card.test.ts.
 */
import { chooseSavedCard, type SavedCards } from "./connect.ts";
import { euro } from "./policy.ts";
import { whenLong } from "./format.ts";

/** The card saved on exactly this account (undefined = Northbank's own), or null. Never a copy from another account. */
export function cardOnAccount(saved: SavedCards | null | undefined, account: string | undefined) {
  if (!saved) return null;
  const choice = chooseSavedCard(saved, account);
  return choice.mode === "use" ? { stripeCustomerId: choice.stripeCustomerId, paymentMethodId: choice.paymentMethodId } : null;
}

/** An expired card isn't offered (Stripe would decline it anyway). */
export function cardExpired(card: { exp_month?: number | null; exp_year?: number | null } | null | undefined, now = new Date()) {
  if (!card?.exp_month || !card?.exp_year) return false;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return card.exp_year < y || (card.exp_year === y && card.exp_month < m);
}

/** What staff tick, word for word. The same words go in the audit log as "agreed on the call". */
export function agreementSentence(amountMinor: number, treatment: string, startsAtISO: string) {
  return `The patient agreed on this call to pay ${euro(amountMinor)} for ${treatment} on ${whenLong(startsAtISO)}.`;
}

export type NotChargedCode = "authentication_required" | "card_declined" | "card_unavailable" | "no_saved_card";
export const FALLBACK_CODES: readonly string[] = ["authentication_required", "card_declined", "card_unavailable", "no_saved_card"];

/** Where an approval ended up, for staff (lib/phone-saved-card.ts). */
export const APPROVAL_MESSAGES = {
  failed: "Their bank didn't approve the payment, so nothing was charged.",
  expired: "The approval link expired before they approved it, so nothing was charged and the time is free again.",
} as const;

/** Why the saved card wasn't charged, for staff. The page then offers "Send a payment link instead". */
export function notChargedReason(code: NotChargedCode, bankMessage?: string) {
  switch (code) {
    case "authentication_required":
      return "Their bank wants them to approve this payment themselves, so the saved card wasn't charged.";
    case "card_declined":
      return `The saved card was declined${bankMessage ? ` (${bankMessage.replace(/\.$/, "")})` : ""}, so nothing was charged.`;
    default:
      return "Their saved card can't be used for this appointment any more, so nothing was charged.";
  }
}
