import { test } from "vitest";
import assert from "node:assert/strict";
import { formatNumber, invoiceEmail, invoicesStart, isInvoiceNumber, lineFor, pdfFilename, refsText, workFor } from "../../core/hub-invoice.ts";
import { needsClinikoInvoice } from "../../core/invoicing.ts";
import type { PaymentEntry } from "../../lib/bookings.ts";

const pay = (over: Partial<PaymentEntry> = {}): PaymentEntry => ({
  paymentIntentId: "pi_1", kind: "full", amountMinor: 8500, refundedMinor: 0, currency: "eur", destination: "therapist", directOnAccount: "acct_1", at: "2026-11-03T10:00:00Z", ...over,
});
const START = Date.parse("2026-11-02T00:00:00Z");

test("REQ-INV-001 off until HUB_INVOICES_START; a date or a date-time", () => {
  assert.equal(invoicesStart(undefined), null);
  assert.equal(invoicesStart(" "), null);
  assert.equal(invoicesStart("nonsense"), null);
  assert.equal(invoicesStart("2026-11-02"), START);
  assert.equal(invoicesStart("2026-11-02T09:00:00Z"), Date.parse("2026-11-02T09:00:00Z"));
});

test("REQ-INV-002 numbers: own series, can't clash with Cliniko's", () => {
  assert.equal(formatNumber(12), "NB-W-000012");
  assert.equal(isInvoiceNumber("NB-W-000012"), true);
  assert.equal(isInvoiceNumber("0000008"), false);
  assert.equal(pdfFilename({ kind: "invoice", number: "NB-W-000012" }), "Northbank-invoice-NB-W-000012.pdf");
  assert.doesNotMatch(pdfFilename({ kind: "credit_note", number: "NB-W-000013" }), /\s/);
});

test("REQ-INV-003 an invoice for each payment from the start; none before it or for Cliniko-made bookings", () => {
  const none = () => null;
  assert.deepEqual(workFor({ payments: [pay()] }, none, null), []);
  assert.equal(workFor({ payments: [pay({ at: "2026-11-01T23:59:00Z" })] }, none, START).length, 0);
  // A late-cancel fee the Hub charged on a booking made in Cliniko still gets one.
  assert.equal(workFor({ payments: [pay({ kind: "late_cancel" })] }, none, START).length, 1);
  assert.equal(workFor({ payments: [pay({ amountMinor: 0 })] }, none, START).length, 0);
  const w = workFor({ payments: [pay(), pay({ paymentIntentId: "pi_2", kind: "no_show", amountMinor: 4000 })] }, none, START);
  assert.deepEqual(w.map((x) => [x.type, x.payment.paymentIntentId]), [["invoice", "pi_1"], ["invoice", "pi_2"]]);
});

test("REQ-INV-004 a credit note for each refund not credited yet, never more than was paid", () => {
  const w1 = workFor({ payments: [pay({ refundedMinor: 8500 })] }, () => null, START);
  assert.deepEqual(w1.map((x) => x.type), ["invoice", "credit"]);
  const w2 = workFor({ payments: [pay({ refundedMinor: 5000 })] }, () => ({ invoiceNumber: "NB-W-000001", creditedMinor: 2000 }), START);
  assert.equal(w2.length, 1);
  assert.equal(w2[0].type === "credit" && w2[0].amountMinor, 3000);
  assert.equal(workFor({ payments: [pay({ refundedMinor: 5000 })] }, () => ({ invoiceNumber: "NB-W-000001", creditedMinor: 5000 }), START).length, 0);
  const over = workFor({ payments: [pay({ refundedMinor: 9999 })] }, () => ({ invoiceNumber: "NB-W-000001", creditedMinor: 0 }), START);
  assert.equal(over[0].type === "credit" && over[0].amountMinor, 8500);
});

test("REQ-INV-005 lines say what the payment was for", () => {
  const b = { appointmentTypeName: "3. Physiotherapy - Return Patient", startsAtISO: "2026-11-05T10:00:00Z" };
  assert.equal(lineFor(b, { kind: "full", amountMinor: 8500 }, "2026-11-05").description, "Physiotherapy - Return Patient");
  assert.equal(lineFor(b, { kind: "deposit", amountMinor: 2000 }, "2026-11-05").description, "Physiotherapy - Return Patient (deposit)");
  assert.equal(lineFor(b, { kind: "no_show", amountMinor: 8500 }, "2026-11-05").description, "Missed appointment fee: Physiotherapy - Return Patient");
  assert.equal(lineFor(b, { kind: "late_cancel", amountMinor: 8500 }, "2026-11-05").description, "Late cancellation fee: Physiotherapy - Return Patient");
  assert.equal(lineFor(b, { kind: "extra", amountMinor: 2000, label: "Shockwave" }, "2026-11-05").description, "Shockwave (added on the day)");
  assert.equal(lineFor(b, { kind: "extra", amountMinor: 2000 }, "2026-11-05").description, "Extra treatment (added on the day)");
});

test("REQ-INV-006 reference numbers and the email words", () => {
  assert.equal(refsText([{ name: "CORU", number: "PH012345" }, { name: "VHI", number: " 778 " }, { name: "Laya", number: "" }]), "CORU PH012345 · VHI 778");
  const inv = { kind: "invoice" as const, number: "NB-W-000012", patient: { name: "Aoife Byrne", email: "a@b.ie" }, lines: [{ description: "Physiotherapy", day: "2026-11-05", amountMinor: 8500 }], totalMinor: 8500 };
  const m = invoiceEmail(inv);
  assert.equal(m.subject, "Invoice #NB-W-000012 - Northbank Physio");
  assert.match(m.text, /^Hi Aoife,\n\nAttached is your invoice from Northbank Physio for Physiotherapy on 5 November 2026\./);
  assert.match(m.text, /This invoice has already been paid\./);
  const cn = invoiceEmail({ ...inv, kind: "credit_note", number: "NB-W-000013", totalMinor: -8500, originalNumber: "NB-W-000012" });
  assert.equal(cn.subject, "Credit note #NB-W-000013 - Northbank Physio");
  assert.match(cn.text, /\(invoice #NB-W-000012\)/);
});

test("REQ-INV-007 'Not invoiced yet' only lists money from before Hub invoices started", () => {
  const before = pay({ at: "2026-11-01T10:00:00Z" });
  assert.equal(needsClinikoInvoice({ payments: [pay()], status: "booked" }, null), true);
  assert.equal(needsClinikoInvoice({ payments: [pay()], status: "booked" }, START), false);
  assert.equal(needsClinikoInvoice({ payments: [before, pay({ paymentIntentId: "pi_2" })], status: "booked" }, START), true);
});
