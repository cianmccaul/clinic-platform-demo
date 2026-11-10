/**
 * Money: stands in for Stripe. Therapists are self-employed, so a payment
 * for their appointment is a direct charge on their own account; staff
 * paid by the clinic are charged on the clinic's account.
 */
import type { BookingRecord, PaymentEntry, PaymentKind } from "@/lib/bookings";
import { accountFor } from "./clinic";
import { type Db, type PaymentIntent, stripeId } from "./db";

export function charge(db: Db, now: number, p: { practitionerId: string | null; amountMinor: number; description: string; patientId?: string | null; card?: { brand: string; last4: string } }): PaymentIntent {
  if (!Number.isInteger(p.amountMinor) || p.amountMinor <= 0) throw new Error("Amount must be a whole number of cents above zero.");
  const pi: PaymentIntent = {
    id: stripeId(db, "pi"),
    account: p.practitionerId ? accountFor(p.practitionerId) : null,
    amount: p.amountMinor,
    amount_refunded: 0,
    created: new Date(now).toISOString(),
    card: p.card ?? { brand: "visa", last4: "4242" },
    patientId: p.patientId ?? null,
    description: p.description,
  };
  db.payments.push(pi);
  return pi;
}

/** A payment as it's recorded on the booking (production's PaymentEntry). */
export function entryFor(pi: PaymentIntent, kind: PaymentKind, label?: string): PaymentEntry {
  return {
    paymentIntentId: pi.id,
    kind,
    amountMinor: pi.amount,
    refundedMinor: pi.amount_refunded,
    currency: "eur",
    destination: pi.account ? "therapist" : "clinic",
    ...(pi.account ? { directOnAccount: pi.account } : {}),
    at: pi.created,
    ...(label ? { label } : {}),
  };
}

export function refundPayment(db: Db, now: number, paymentIntentId: string, amountMinor: number, reason: string, by: string) {
  const pi = db.payments.find((x) => x.id === paymentIntentId);
  if (!pi) throw new Error("Payment not found");
  const amount = Math.min(amountMinor, pi.amount - pi.amount_refunded);
  if (amount <= 0) return 0;
  pi.amount_refunded += amount;
  db.refunds.push({ id: stripeId(db, "re"), payment_intent: pi.id, amount, reason, by, created: new Date(now).toISOString() });
  return amount;
}

/** Refund up to `want` across a booking's payments, newest first, and keep the record in step. */
export function refundUpTo(db: Db, now: number, b: BookingRecord, want: number, reason: string, by: string) {
  let left = want;
  let total = 0;
  for (const p of [...b.payments].reverse()) {
    if (left <= 0) break;
    const r = refundPayment(db, now, p.paymentIntentId, Math.min(left, p.amountMinor - p.refundedMinor), reason, by);
    p.refundedMinor += r;
    left -= r;
    total += r;
  }
  return total;
}
