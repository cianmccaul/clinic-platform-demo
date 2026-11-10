import { test } from "vitest";
import assert from "node:assert/strict";
import {
  CANCEL_WINDOW_HOURS,
  balanceOwedMinor,
  dublinDay,
  isOutsideCancelWindow,
  patientCancelOutcome,
  toMinor,
} from "../../core/policy.ts";

const at = (iso: string) => new Date(iso).getTime();

test("REQ-POL-001 cancelling more than 24h ahead is free (refund)", () => {
  const now = at("2026-10-14T09:00:00Z");
  assert.equal(patientCancelOutcome("2026-10-15T09:01:00Z", now), "refund");
});

test("REQ-POL-001 exactly 24h ahead counts as late (full fee)", () => {
  const now = at("2026-10-14T09:00:00Z");
  assert.equal(isOutsideCancelWindow("2026-10-15T09:00:00Z", now), false);
  assert.equal(patientCancelOutcome("2026-10-15T09:00:00Z", now), "charge_full");
});

test("REQ-POL-002 cancelling within 24h charges the full fee", () => {
  const now = at("2026-10-14T09:00:00Z");
  assert.equal(patientCancelOutcome("2026-10-15T08:59:00Z", now), "charge_full");
  assert.equal(patientCancelOutcome("2026-10-14T10:00:00Z", now), "charge_full");
});

test("REQ-POL-003 24h window is real elapsed hours across the 25 Oct 2026 clock change", () => {
  // Clocks go back 02:00 IST → 01:00 GMT on Sun 25 Oct 2026, so the day has 25 hours.
  // Appointment Mon 26 Oct 09:00 Dublin (= 09:00Z, GMT). Cancel Sun 25 Oct 09:30 Dublin (= 09:30Z).
  assert.equal(patientCancelOutcome("2026-10-26T09:00:00Z", at("2026-10-25T09:30:00Z")), "charge_full");
  // Cancel Sat 24 Oct 09:30 Dublin (IST, = 08:30Z): 48.5 real hours ahead → free.
  assert.equal(patientCancelOutcome("2026-10-26T09:00:00Z", at("2026-10-24T08:30:00Z")), "refund");
  // Cancel Sun 25 Oct 08:59 Dublin (= 08:59Z): 24h01m ahead → free.
  assert.equal(patientCancelOutcome("2026-10-26T09:00:00Z", at("2026-10-25T08:59:00Z")), "refund");
  assert.equal(CANCEL_WINDOW_HOURS, 24);
});

test("REQ-POL-004 Irish calendar day, not UTC day", () => {
  assert.equal(dublinDay("2026-10-01T23:30:00Z"), "2026-10-02"); // IST (UTC+1)
  assert.equal(dublinDay("2026-11-01T23:30:00Z"), "2026-11-01"); // GMT
});

test("REQ-POL-005 money maths in integer cents", () => {
  assert.equal(toMinor(80), 8000);
  assert.equal(toMinor(19.99), 1999);
  assert.equal(toMinor(0.1 + 0.2), 30);
  assert.equal(balanceOwedMinor(10000, 2000), 8000);
  assert.equal(balanceOwedMinor(10000, 12000), 0);
});

import { addDays, dublinMidnightUTC } from "../../core/policy.ts";

test("REQ-OPS-003 Irish midnight in UTC across summer/winter time", () => {
  assert.equal(new Date(dublinMidnightUTC("2026-10-01")).toISOString(), "2026-09-30T23:00:00.000Z"); // IST
  assert.equal(new Date(dublinMidnightUTC("2026-10-25")).toISOString(), "2026-10-24T23:00:00.000Z"); // clocks change that night
  assert.equal(new Date(dublinMidnightUTC("2026-10-26")).toISOString(), "2026-10-26T00:00:00.000Z"); // GMT
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-10-25", -1), "2026-10-24");
});

import { clampAvailabilityRange } from "../../core/policy.ts";

test("REQ-BK-006 availability never asks Cliniko for a past date (midnight–1am Irish time)", () => {
  // 00:30 on 30 Sep in Dublin is still 29 Sep in UTC.
  const today = dublinDay("2026-09-29T23:30:00Z");
  assert.equal(today, "2026-09-30");
  assert.deepEqual(clampAvailabilityRange("2026-09-29", "2026-10-05", today), { from: "2026-09-30", to: "2026-10-05" });
  assert.deepEqual(clampAvailabilityRange("2026-10-06", "2026-10-12", today), { from: "2026-10-06", to: "2026-10-12" });
  assert.equal(clampAvailabilityRange("2026-09-22", "2026-09-28", today), null);
});

test("online booking window: 12 weeks, matching Cliniko's setting (4 Nov 2026)", async () => {
  const { ONLINE_BOOKING_WEEKS_AHEAD, lastOnlineBookingDay, onlineBookingWeeks } = await import("../../core/policy.ts");
  assert.equal(ONLINE_BOOKING_WEEKS_AHEAD, 12);
  assert.equal(lastOnlineBookingDay("2026-11-04"), "2027-01-26");
  const weeks = onlineBookingWeeks("2026-11-04");
  assert.equal(weeks.length, 12);
  assert.deepEqual(weeks[0], { from: "2026-11-04", to: "2026-11-10" });
  // Clare's next free time on 3 Nov was 25 Nov: the old 3-week window (to 24 Nov) missed it, week 4 has it.
  assert.deepEqual(weeks[3], { from: "2026-11-25", to: "2026-12-01" });
  assert.equal(weeks[11].to, lastOnlineBookingDay("2026-11-04"));
  // Every window is 7 days, back to back, so Cliniko's 7-day limit is never passed.
  for (let i = 1; i < weeks.length; i++) assert.equal(weeks[i].from > weeks[i - 1].to, true);
});
