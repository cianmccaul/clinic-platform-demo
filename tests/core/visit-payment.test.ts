import { test } from "vitest";
import assert from "node:assert/strict";
import {
  clinicPaidIds,
  parseEuroInput,
  paysClinic,
  suggestedVisitMinor,
  visitAmountRefusal,
  visitAppointmentRefusal,
  visitPaidNote,
  visitPaymentKind,
} from "../../core/visit-payment.ts";

const CLARE = "105";
const NOW = Date.parse("2026-11-06T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

test("Clare's payments always go to Northbank's account; others only when listed", () => {
  assert.equal(paysClinic(CLARE, {}), true);
  assert.equal(paysClinic("101", {}), false);
  assert.equal(paysClinic("55", { CLINIC_PAID_PRACTITIONER_IDS: " 55 , x" }), true);
  assert.deepEqual([...clinicPaidIds({ CLINIC_PAID_PRACTITIONER_IDS: "abc" })], [CLARE]);
});

test("only appointments that have started, in the last 30 days, not cancelled", () => {
  assert.equal(visitAppointmentRefusal({ starts_at: "2026-11-06T14:00:00Z" }, NOW), null);
  assert.equal(visitAppointmentRefusal({ starts_at: new Date(NOW - 29 * DAY).toISOString() }, NOW), null);
  assert.match(visitAppointmentRefusal({ starts_at: "2026-11-06T16:00:00Z" }, NOW)!, /hasn't started/);
  assert.match(visitAppointmentRefusal({ starts_at: new Date(NOW - 40 * DAY).toISOString() }, NOW)!, /30 days/);
  assert.match(visitAppointmentRefusal({ starts_at: "2026-11-06T14:00:00Z", cancelled_at: "2026-11-05T10:00:00Z" }, NOW)!, /cancelled/);
  assert.match(visitAppointmentRefusal({ starts_at: null }, NOW)!, /couldn't find/);
});

test("amounts between €1 and €1,000, whole cents", () => {
  assert.equal(visitAmountRefusal(6500), null);
  assert.ok(visitAmountRefusal(50));
  assert.ok(visitAmountRefusal(100_001));
  assert.ok(visitAmountRefusal(65.5));
});

test("suggested amount is the price less what's already paid", () => {
  assert.equal(suggestedVisitMinor(8000, 0), 8000);
  assert.equal(suggestedVisitMinor(8000, 2500), 5500);
  assert.equal(suggestedVisitMinor(8000, 9000), 0);
  assert.equal(suggestedVisitMinor(null, 0), null);
  assert.equal(visitPaymentKind(0), "full");
  assert.equal(visitPaymentKind(2500), "balance");
});

test("euro input", () => {
  assert.equal(parseEuroInput("65"), 6500);
  assert.equal(parseEuroInput("€65.50"), 6550);
  assert.equal(parseEuroInput("65,5"), 6550);
  assert.equal(parseEuroInput(" 0.99 "), 99);
  assert.equal(parseEuroInput("abc"), null);
  assert.equal(parseEuroInput("65.555"), null);
  assert.equal(parseEuroInput(""), null);
});

test("the Cliniko note says where the money went", () => {
  assert.match(visitPaidNote({ amount: "€65.00", destination: "clinic", ref: "pi_1", by: "Clare Morgan (Owner)" }), /Northbank's Stripe.*pi_1/);
  assert.match(visitPaidNote({ amount: "€65.00", destination: "therapist", ref: "pi_2", by: "Aoife (Therapist)" }), /therapist's Stripe/);
});
