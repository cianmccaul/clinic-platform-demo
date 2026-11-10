/**
 * "Not invoiced yet" (decision 20 Oct 2026): paid online or phone bookings
 * that still need a Cliniko invoice. Cliniko's API can't create invoices
 * (they're read-only), so reception makes each one in Cliniko and presses
 * Send; the Hub only finds the ones still missing. Pure, unit-tested in
 * tests/invoicing.test.ts.
 */
import type { BookingRecord } from "../lib/bookings.ts";
import { invoicePayments } from "./hub-invoice.ts";

/** The clinic's Cliniko, for links staff open in their browser. */
export const CLINIKO_WEB_URL = "https://northbank.example-cliniko.com";

export const clinikoPatientUrl = (patientId: string) => `${CLINIKO_WEB_URL}/patients/${encodeURIComponent(patientId)}`;

/** Default window: the last 60 days and the next 30. Never more than 120 days. */
export const DEFAULT_BACK_DAYS = 60;
export const DEFAULT_AHEAD_DAYS = 30;
export const MAX_RANGE_DAYS = 120;

const net = (b: Pick<BookingRecord, "payments">) => b.payments.reduce((s, p) => s + p.amountMinor - p.refundedMinor, 0);

/**
 * Does this booking need a Cliniko invoice? Yes when money was kept for it:
 * paid online or by phone link, not fully refunded. That includes a late
 * cancellation where the fee was kept. Bookings made by hand in Cliniko
 * (source "cliniko") are invoiced there already, when paid at the clinic.
 */
export function needsClinikoInvoice(b: Pick<BookingRecord, "payments" | "status" | "source" | "voucher">, hubInvoicesFromMs: number | null = null): boolean {
  if (b.source === "cliniko") return false;
  // Once Hub invoices are on (HUB_INVOICES_START), payments from then on get a Hub invoice instead
  // (core/hub-invoice.ts), so only money kept from earlier payments still needs one in Cliniko.
  // A gift voucher used when booking online (v2) counts like a payment.
  const all = invoicePayments(b);
  const before = hubInvoicesFromMs == null ? all : all.filter((p) => Date.parse(p.at) < hubInvoicesFromMs);
  return net({ payments: before }) > 0;
}

/** The days from `from` to `to` (YYYY-MM-DD, both included), or null if the range is bad or too long. */
export function daysInRange(from: string, to: string): string[] | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) return null;
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  const n = Math.round((b - a) / 86_400_000) + 1;
  if (n > MAX_RANGE_DAYS) return null;
  return Array.from({ length: n }, (_, i) => new Date(a + i * 86_400_000).toISOString().slice(0, 10));
}

/** An invoice counts unless it was deleted. Archived or reversed ones still mean "it was invoiced". */
export function countsAsInvoice(inv: { deleted_at?: string | null }): boolean {
  return !inv.deleted_at;
}
