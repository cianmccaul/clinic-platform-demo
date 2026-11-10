/**
 * The clinic's cut when a payment is made on a therapist's own Stripe
 * account (a Connect "application fee", ADR 0006). Set on the server only,
 * from CLINIC_FEE_PERCENT — never from the browser. 0 (the default) means the
 * therapist keeps the whole payment, less the Stripe fees they pay themselves.
 */
export function applicationFeeMinor(amountMinor: number, percent: number) {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  const p = Math.min(percent, 100);
  return Math.min(amountMinor, Math.round((amountMinor * p) / 100));
}

export function parseFeePercent(raw: string | undefined) {
  const n = Number(raw ?? "0");
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 0;
}
