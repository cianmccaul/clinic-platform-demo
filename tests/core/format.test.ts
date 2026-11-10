import { test } from "vitest";
import assert from "node:assert/strict";
import { STRIPE_ITEM_NAME, checkoutLineItem, dayLabel, dayLong, dayPart, dayShort, eur, mondayOf, stripeAppointmentLabel, stripeLineItem, timeShort, whenLong, whenShort } from "../../core/format.ts";
import { POLICY_SENTENCE, formatDublin } from "../../core/policy.ts";

test("Irish date order and am/pm times, in Irish time (IST, UTC+1)", () => {
  assert.equal(dayShort("2026-10-13T09:30:00Z"), "Tue 13 Oct");
  assert.equal(dayLong("2026-10-13T09:30:00Z"), "Tuesday 13 October");
  assert.equal(timeShort("2026-10-13T09:30:00Z"), "10:30am");
  assert.equal(timeShort("2026-10-13T11:00:00Z"), "12:00pm");
  assert.equal(timeShort("2026-10-13T23:15:00Z"), "12:15am");
  assert.equal(whenShort("2026-10-13T09:30:00Z"), "Tue 13 Oct, 10:30am");
  assert.equal(whenLong("2026-10-13T09:30:00Z"), "Tuesday 13 October, 10:30am");
  assert.equal(formatDublin("2026-10-13T09:30:00Z"), "Tuesday 13 October, 10:30am");
});

test("clocks go back Sun 25 Oct 2026: same UTC hour shows an hour earlier after", () => {
  assert.equal(timeShort("2026-10-24T09:00:00Z"), "10:00am"); // IST
  assert.equal(timeShort("2026-10-26T09:00:00Z"), "9:00am"); // GMT
});

test("slots group into morning, afternoon and evening by Irish time", () => {
  assert.equal(dayPart("2026-10-13T10:59:00Z"), "Morning"); // 11:59 IST
  assert.equal(dayPart("2026-10-13T11:00:00Z"), "Afternoon"); // 12:00 IST
  assert.equal(dayPart("2026-10-13T15:59:00Z"), "Afternoon"); // 16:59 IST
  assert.equal(dayPart("2026-10-13T16:00:00Z"), "Evening"); // 17:00 IST
});

test("week strip helpers", () => {
  assert.equal(mondayOf("2026-10-13"), "2026-10-12");
  assert.equal(mondayOf("2026-10-12"), "2026-10-12");
  assert.equal(mondayOf("2026-10-18"), "2026-10-12"); // Sunday
  assert.deepEqual(dayLabel("2026-10-13"), { weekday: "Tue", date: "13", month: "Oct", full: "Tue 13 Oct" });
});

test("money", () => {
  assert.equal(eur(20), "€20.00");
  assert.equal(eur(72.5), "€72.50");
});

test("the review screen's treatment line (the Hub's own screens only)", () => {
  assert.deepEqual(checkoutLineItem("1. Physiotherapy assessment", "2026-10-13T09:30:00Z"), {
    name: "Physiotherapy assessment",
    description: "Tue 13 Oct, 10:30am · Northbank, 12 Quay Street, Dublin 2",
  });
});

test("Stripe never gets the treatment's name (15 Oct)", () => {
  assert.deepEqual(stripeLineItem("2026-10-13T09:30:00Z"), {
    name: "Northbank appointment",
    description: "Tue 13 Oct, 10:30am · Northbank, 12 Quay Street, Dublin 2",
  });
  assert.equal(stripeAppointmentLabel("2026-10-13T09:30:00Z"), "Northbank appointment Tue 13 Oct, 10:30am");
  assert.equal(STRIPE_ITEM_NAME, "Northbank appointment");
});

test("one cancellation sentence, matching the real policy (full fee inside 24h)", () => {
  assert.equal(
    POLICY_SENTENCE,
    "Free to cancel or change until 24 hours before. After that, or if you miss the appointment, the full appointment fee is charged."
  );
});
