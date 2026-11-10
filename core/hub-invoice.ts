/**
 * Hub-made invoices (plan-2026-10-27-hub-invoices, agreed with Cian 27 Oct 2026).
 *
 * Every payment the Hub takes (online booking, phone pay link, waitlist offer,
 * balance, no-show or late-cancel fee, extra on the day) gets an invoice from
 * Northbank Physio, marked paid, with the therapist and their reference
 * numbers (what health insurers need). A refund gets a credit note for the
 * amount refunded. Payments taken in the clinic stay in Cliniko, which
 * invoices them itself.
 *
 * Invoices start from HUB_INVOICES_START (an ISO date/time); payments before
 * it were invoiced in Cliniko by reception, so they never get a Hub invoice.
 *
 * Pure, no I/O; tested in tests/hub-invoice.test.ts.
 */
import type { BookingRecord, PaymentEntry, PaymentKind } from "../lib/bookings.ts";
import { fillTemplate, type EmailOverrides } from "./email-templates.ts";

export const COMPANY = {
  name: "Northbank Physio",
  tradingAs: "Northbank Physio",
  address: ["12 Quay Street", "Dublin 2", "D02 X000"],
  cro: "000000 (demo)",
  phone: "01 555 0100",
  email: "hello@northbank.example",
  web: "www.northbank.example",
};
export const VAT_NOTE = "Medical services, exempt from VAT.";
export const NUMBER_PREFIX = "NB-W-";

export type DocKind = "invoice" | "credit_note";
export type RefNumber = { name: string; number: string };

export type InvoiceLine = { description: string; day: string; amountMinor: number };

export type HubInvoice = {
  number: string;
  kind: DocKind;
  issuedAt: string;
  issueDay: string;
  appointmentId: string;
  paymentIntentId: string;
  clinikoPatientId: string;
  patient: { name: string; email: string | null };
  practitioner: { id: string; name: string; refs: RefNumber[] };
  /** Who the card payment went to: the therapist's own Stripe account, or the clinic's. */
  paidTo: string;
  /** Paid with a Northbank gift voucher when booked online (v2), not a card. */
  paidWith?: "voucher";
  voucherCode?: string;
  lines: InvoiceLine[];
  totalMinor: number; // negative on a credit note
  /** On a receipt: the appointment's day now (moves with a reschedule; the PDF keeps the day it was issued with). */
  treatmentDay?: string;
  /** On a credit note: the invoice it reverses. */
  originalNumber?: string;
  /** On an invoice: amount credited so far, and the credit notes. */
  creditedMinor?: number;
  creditNotes?: string[];
  emailedAt?: string;
  emailAttempts?: number;
  /** Which Resend idempotency key the next email uses (inv-<number>-<n>). */
  emailKeySeq?: number;
  /** An email was handed to Resend and we never heard back: the next try reuses its key. */
  emailInFlight?: boolean;
  /** Not before this time: Cliniko uploads that failed are spread out. */
  clinikoNextAt?: string;
  emailError?: string;
  clinikoUploadedAt?: string;
  clinikoAttempts?: number;
  clinikoError?: string;
};

export const formatNumber = (seq: number) => `${NUMBER_PREFIX}${String(seq).padStart(6, "0")}`;
export const isInvoiceNumber = (s: string) => /^NB-W-\d{6,}$/.test(s);

/** HUB_INVOICES_START as a time, or null when Hub invoices are off. */
export function invoicesStart(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const t = Date.parse(raw.trim().length === 10 ? `${raw.trim()}T00:00:00Z` : raw.trim());
  return Number.isFinite(t) ? t : null;
}

const KIND_TEXT: Record<PaymentKind, string> = {
  deposit: "deposit",
  full: "",
  balance: "balance",
  no_show: "Missed appointment fee",
  late_cancel: "Late cancellation fee",
  extra: "",
};

const cleanType = (s: string | undefined) => (s ?? "Appointment").replace(/^\d+\.\s*/, "").trim() || "Appointment";

/** The invoice line for one payment. */
export function lineFor(b: Pick<BookingRecord, "appointmentTypeName" | "startsAtISO">, p: Pick<PaymentEntry, "kind" | "amountMinor"> & { label?: string }, day: string): InvoiceLine {
  const type = cleanType(b.appointmentTypeName);
  let description: string;
  if (p.kind === "full") description = type;
  else if (p.kind === "deposit" || p.kind === "balance") description = `${type} (${KIND_TEXT[p.kind]})`;
  else if (p.kind === "extra") description = p.label?.trim() ? `${p.label.trim()} (added on the day)` : "Extra treatment (added on the day)";
  else description = `${KIND_TEXT[p.kind]}: ${type}`;
  return { description, day, amountMinor: p.amountMinor };
}

export type Issued = { invoiceNumber: string; creditedMinor: number } | null;

/**
 * Everything to invoice on a booking: its card payments, plus the gift voucher part (v2) as a
 * payment of its own, so the invoice shows the full fee (what a health insurer needs). Putting
 * the voucher amount back (a cancellation) counts as its refund, so it gets a credit note.
 */
export function invoicePayments(b: Pick<BookingRecord, "payments" | "voucher">): PaymentEntry[] {
  const v = b.voucher;
  if (!v?.eventId || !(v.amountMinor > 0)) return b.payments;
  return [
    ...b.payments,
    { paymentIntentId: `vch_${v.eventId}`, kind: "full", amountMinor: v.amountMinor, refundedMinor: Math.min(v.amountMinor, v.returnedMinor ?? 0), currency: "eur", destination: "clinic", at: v.at, voucherCode: v.code },
  ];
}

export type Work =
  | { type: "invoice"; payment: PaymentEntry }
  | { type: "credit"; payment: PaymentEntry; invoiceNumber: string; amountMinor: number };

/**
 * What still has to be issued for a booking: an invoice for every payment from the start
 * time on that doesn't have one, and a credit note for any refund not credited yet.
 */
export function workFor(b: Pick<BookingRecord, "payments">, issued: (paymentIntentId: string) => Issued, startMs: number | null): Work[] {
  // Every payment on a booking record was taken by the Hub, including a late-cancel fee on a
  // booking made in Cliniko (source "cliniko"), so each gets a document whatever the source.
  if (startMs == null) return [];
  const out: Work[] = [];
  for (const p of b.payments) {
    if (!(p.amountMinor > 0) || Date.parse(p.at) < startMs) continue;
    const got = issued(p.paymentIntentId);
    if (!got) {
      out.push({ type: "invoice", payment: p });
      if (p.refundedMinor > 0) out.push({ type: "credit", payment: p, invoiceNumber: "", amountMinor: Math.min(p.refundedMinor, p.amountMinor) });
      continue;
    }
    const owed = Math.min(p.refundedMinor, p.amountMinor) - got.creditedMinor;
    if (owed > 0) out.push({ type: "credit", payment: p, invoiceNumber: got.invoiceNumber, amountMinor: owed });
  }
  return out;
}

/** Reference numbers as printed: "CORU PH012345 · VHI 123456". */
export const refsText = (refs: RefNumber[]) =>
  refs
    .filter((r) => r.number?.trim())
    .map((r) => `${r.name?.trim() || "Ref."} ${r.number.trim()}`)
    .join(" · ");

export const euroText = (minor: number) => {
  const neg = minor < 0;
  const v = Math.abs(minor) / 100;
  return `${neg ? "-" : ""}€${v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const dayText = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * The email that carries the PDF: the same short words as Cliniko's own invoice emails
 * (Settings > Invoice settings, 27 Oct 2026), so a patient gets one style from both.
 */
export function invoiceEmail(inv: Pick<HubInvoice, "kind" | "number" | "patient" | "lines" | "totalMinor" | "originalNumber">, overrides?: EmailOverrides | null) {
  const first = inv.patient.name.split(" ")[0] || "there";
  const what = (inv.lines[0]?.description ?? "your appointment").replace(/^Refund:\s*/, "");
  const when = inv.lines[0]?.day ? ` on ${dayText(inv.lines[0].day)}` : "";
  const mail =
    inv.kind === "credit_note"
      ? fillTemplate(
          "credit_note",
          { first_name: first, credit_number: String(inv.number), invoice_number: String(inv.originalNumber ?? ""), company: COMPANY.name, amount: euroText(-inv.totalMinor), what: `${what}${when}` },
          overrides
        )
      : fillTemplate("invoice", { first_name: first, invoice_number: String(inv.number), company: COMPANY.name, what: `${what}${when}` }, overrides);
  return { subject: mail.subject, text: mail.text };
}

/** No spaces: the name becomes part of the file's address when it's saved in Cliniko. */
export const pdfFilename = (inv: Pick<HubInvoice, "kind" | "number">) => `Northbank-${inv.kind === "credit_note" ? "credit-note" : "invoice"}-${inv.number}.pdf`;
