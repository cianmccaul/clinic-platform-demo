/**
 * How a refund of `amountMinor` is split across a booking's payments: newest
 * first (so an extra charged on the day is given back before the appointment
 * fee), never more than is left on any one payment. Pure, unit-tested in
 * tests/refunds.test.ts; lib/charges.ts carries the plan out in Stripe.
 */
export type Refundable = { paymentIntentId: string; amountMinor: number; refundedMinor: number; at: string };

export function planRefund(payments: Refundable[], amountMinor: number): { paymentIntentId: string; amountMinor: number }[] {
  let left = Math.max(0, Math.floor(amountMinor));
  const plan: { paymentIntentId: string; amountMinor: number }[] = [];
  for (const p of [...payments].sort((a, b) => b.at.localeCompare(a.at))) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, p.amountMinor - p.refundedMinor));
    if (take > 0) {
      plan.push({ paymentIntentId: p.paymentIntentId, amountMinor: take });
      left -= take;
    }
  }
  return plan;
}

/** What staff typed as a euro amount ("45", "45.5", "€45.50") in cents, or null. */
export function parseEuroToMinor(s: string): number | null {
  const t = s.replace(/[€,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const m = Math.round(Number(t) * 100);
  return m > 0 ? m : null;
}
