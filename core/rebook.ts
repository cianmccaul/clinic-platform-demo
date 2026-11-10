/**
 * "Already paid: pick another time" rules (lib/rebook.ts). Pure, unit-tested.
 */

/** Days a patient has to pick a new time before the payment is refunded automatically. */
export const REBOOK_DAYS = 7;

export function rebookRefundBy(createdAtISO: string) {
  return new Date(Date.parse(createdAtISO) + REBOOK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
