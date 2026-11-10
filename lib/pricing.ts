/** The amount a patient pays when booking: the full price from the diary. */
export function amountDueNowEUR(fullPriceEUR: number | null | undefined): number | null {
  return fullPriceEUR != null && Number.isFinite(fullPriceEUR) && fullPriceEUR > 0 ? fullPriceEUR : null;
}

/** How a booking was paid. New bookings are always "full". */
export type PaymentOption = "deposit" | "full";
