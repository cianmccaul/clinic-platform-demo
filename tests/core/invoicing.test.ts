import { test } from "vitest";
import assert from "node:assert/strict";
import { MAX_RANGE_DAYS, clinikoPatientUrl, countsAsInvoice, daysInRange, needsClinikoInvoice } from "../../core/invoicing.ts";

const pay = (amountMinor: number, refundedMinor = 0) => ({
  paymentIntentId: "pi_" + amountMinor + "_" + refundedMinor,
  kind: "full" as const,
  amountMinor,
  refundedMinor,
  currency: "eur",
  destination: "therapist" as const,
  at: "2026-10-20T09:00:00Z",
});

test("REQ-INV-001 a booking needs a Cliniko invoice when money was kept for it", () => {
  assert.equal(needsClinikoInvoice({ status: "booked", payments: [pay(7500)] }), true);
  assert.equal(needsClinikoInvoice({ status: "booked", payments: [pay(7500, 7500)] }), false, "fully refunded");
  assert.equal(needsClinikoInvoice({ status: "booked", payments: [pay(7500, 2500)] }), true, "part refund still kept money");
  assert.equal(needsClinikoInvoice({ status: "cancelled", payments: [pay(7500)] }), true, "late cancel, fee kept");
  assert.equal(needsClinikoInvoice({ status: "cancelled", payments: [pay(7500, 7500)] }), false);
  assert.equal(needsClinikoInvoice({ status: "booked", payments: [] }), false, "nothing paid");
  assert.equal(needsClinikoInvoice({ status: "cancelled", payments: [], source: "cliniko" }), false, "booked in Cliniko by hand");
});

test("REQ-INV-002 the date range is checked and capped", () => {
  assert.deepEqual(daysInRange("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(daysInRange("2026-10-25", "2026-10-25"), ["2026-10-25"], "one day; clock change day included");
  assert.equal(daysInRange("2026-11-02", "2026-10-30"), null, "backwards");
  assert.equal(daysInRange("2026-10-30", "nope"), null);
  assert.equal(daysInRange("2026-01-01", "2026-12-31"), null, "too long");
  assert.equal(daysInRange("2026-01-01", "2026-04-30")!.length, MAX_RANGE_DAYS);
});

test("REQ-INV-003 deleted invoices don't count; links go to the patient in the clinic's Cliniko", () => {
  assert.equal(countsAsInvoice({ deleted_at: null }), true);
  assert.equal(countsAsInvoice({}), true);
  assert.equal(countsAsInvoice({ deleted_at: "2026-10-20T10:00:00Z" }), false);
  assert.equal(clinikoPatientUrl("123"), "https://northbank.example-cliniko.com/patients/123");
});
