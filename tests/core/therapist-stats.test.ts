import { test } from "vitest";
import assert from "node:assert/strict";
import {
  DEFAULT_TIERS, capacityFor, dayKind, maxPatientsFromHours, monthByTherapist, paceFor, periodMonthFor, periodRange, tierIndexFor, tierProblem,
  type InvoiceIn, type TherapistRules,
} from "../../core/therapist-stats.ts";

const inv = (over: Partial<InvoiceIn>): InvoiceIn => ({
  id: "1", practitionerId: "7", businessId: "5", issueDay: "2026-10-06", totalMinor: 8500, status: 20, originalInvoiceId: null, deleted: false, itemNames: [], ...over,
});
const O = { fromDay: "2026-10-01", toDay: "2026-10-31", businessId: "5" };
const rules = (over: Partial<TherapistRules> = {}): TherapistRules => ({ maxPatients: 100, model: "capacity", tiers: [], ...over });

test("REQ-TSTAT-001 sessions: billed invoices, paid or not; EUR 0 invoices listed, not counted", () => {
  const m = monthByTherapist([inv({ id: "1" }), inv({ id: "2", status: 10, totalMinor: 6000 }), inv({ id: "3", totalMinor: 0 }), inv({ id: "4", status: 40, totalMinor: 3000 })], O).get("7")!;
  assert.equal(m.sessions, 3); // status 40 with a positive total is an overpaid invoice, still a session
  assert.equal(m.zeroInvoices, 1);
  assert.equal(m.billedMinor, 17500);
});

test("REQ-TSTAT-002 outside the month, other businesses, deleted invoices and credit notes aren't sessions", () => {
  const m = monthByTherapist([
    inv({ id: "1" }),
    inv({ id: "2", issueDay: "2026-09-30" }),
    inv({ id: "3", businessId: "99" }),
    inv({ id: "4", deleted: true }),
    inv({ id: "5", status: 40, totalMinor: -2000 }),
    inv({ id: "7", status: 40, totalMinor: -500, originalInvoiceId: "nope" }),
    inv({ id: "6", practitionerId: null }),
  ], O).get("7")!;
  assert.equal(m.sessions, 1);
  assert.equal(m.billedMinor, 8500);
});

test("REQ-TSTAT-003 a credit note takes its amount off the invoice it reverses; fully reversed is no session", () => {
  const m = monthByTherapist([
    inv({ id: "1" }),
    inv({ id: "2" }),
    inv({ id: "c1", status: 40, totalMinor: -8500, originalInvoiceId: "1", issueDay: "2026-11-03" }),
    inv({ id: "c2", status: 40, totalMinor: -2500, originalInvoiceId: "2" }),
  ], O).get("7")!;
  assert.equal(m.sessions, 1);
  assert.equal(m.billedMinor, 6000);
});

test("REQ-TSTAT-004 billed splits by weekday, Saturday, Sunday and Irish bank holiday", () => {
  assert.equal(dayKind("2026-10-26"), "bankHoliday"); // October bank holiday
  assert.equal(dayKind("2026-10-24"), "saturday");
  assert.equal(dayKind("2026-10-25"), "sunday");
  assert.equal(dayKind("2026-10-27"), "weekday");
  const m = monthByTherapist([inv({ id: "1", issueDay: "2026-10-24" }), inv({ id: "2", issueDay: "2026-10-26" }), inv({ id: "3", issueDay: "2026-10-27" })], O).get("7")!;
  assert.equal(m.byDay.saturday.billedMinor, 8500);
  assert.equal(m.byDay.bankHoliday.sessions, 1);
  assert.equal(m.byDay.weekday.sessions, 1);
  assert.equal(m.byDay.sunday.sessions, 0);
});

test("REQ-TSTAT-005 shockwave and laser counted once per session from item names", () => {
  const m = monthByTherapist([inv({ id: "1", itemNames: ["Shockwave Therapy", "Shock wave add-on"] }), inv({ id: "2", itemNames: ["High Intensity Laser Therapy"] })], O).get("7")!;
  assert.equal(m.shockwave, 1);
  assert.equal(m.laser, 1);
});

test("REQ-TSTAT-006 tiers: upper limit exclusive, last tier open-ended (room-rentals rule)", () => {
  assert.equal(tierIndexFor(69.9, DEFAULT_TIERS), 1);
  assert.equal(tierIndexFor(70, DEFAULT_TIERS), 2);
  assert.equal(tierIndexFor(0, DEFAULT_TIERS), 0);
  assert.equal(tierIndexFor(100, DEFAULT_TIERS), 4);
  assert.equal(tierIndexFor(130, DEFAULT_TIERS), 4);
});

test("REQ-TSTAT-007 capacity: sessions / max patients, one decimal; sessions to the next tier", () => {
  const c = capacityFor(69, rules({ maxPatients: 100 }))!;
  assert.equal(c.pct, 69);
  assert.equal(c.tierIndex, 1);
  assert.equal(c.toNextTier, 1);
  const top = capacityFor(95, rules())!;
  assert.equal(top.toNextTier, null);
  const odd = capacityFor(80, rules({ maxPatients: 117 }))!; // 68.4%
  assert.equal(odd.tierIndex, 1);
  assert.equal(Math.round(((80 + odd.toNextTier!) / 117) * 1000) / 10 >= 70, true);
  assert.equal(Math.round(((80 + odd.toNextTier! - 1) / 117) * 1000) / 10 < 70, true);
  const big = capacityFor(2000, rules({ maxPatients: 3000 }))!; // 2099/3000 rounds to 70.0%
  assert.equal(big.toNextTier, 99);
  assert.equal(capacityFor(50, rules({ maxPatients: null })), null);
  assert.equal(capacityFor(50, rules({ model: "fixed" })), null);
});

test("REQ-TSTAT-008 the capacity calculator matches the room-rentals tool", () => {
  assert.equal(maxPatientsFromHours({ monthlyHours: 120, breaks30: 4, breaks60: 2, appointmentMinutes: 45 }), 154); // (120 - 4) / 0.75
  assert.equal(maxPatientsFromHours({ monthlyHours: 0, appointmentMinutes: 45 }), null);
});

test("REQ-TSTAT-009 rent period: 29th to 28th; pace on working days (Mon-Sat, not bank holidays) gone", () => {
  assert.deepEqual(periodRange("2026-10"), { fromDay: "2026-09-29", toDay: "2026-10-28" });
  assert.deepEqual(periodRange("2026-01"), { fromDay: "2025-12-29", toDay: "2026-01-28" });
  assert.deepEqual(periodRange("2026-03"), { fromDay: "2026-03-01", toDay: "2026-03-28" }); // no 29 Feb in 2026
  assert.deepEqual(periodRange("2028-03"), { fromDay: "2028-02-29", toDay: "2028-03-28" }); // leap year
  assert.equal(periodMonthFor("2026-10-28"), "2026-10");
  assert.equal(periodMonthFor("2026-10-29"), "2026-11");
  assert.equal(periodMonthFor("2026-12-30"), "2027-01");
  const r = periodRange("2026-10");
  assert.equal(paceFor(10, { ...r, today: "2026-10-01" }), null); // too early (29, 30 Sep gone)
  assert.equal(paceFor(50, { ...r, today: "2026-10-29" }), null); // period over
  // 29 Sep - 28 Oct: 30 days, minus Sundays 4, 11, 18, 25 Oct and the 26 Oct bank holiday = 25 working days.
  // Gone before 15 Oct: 29, 30 Sep + 1-14 Oct minus two Sundays = 14.
  assert.equal(paceFor(56, { ...r, today: "2026-10-15" }), Math.round((56 / 14) * 25));
});

test("REQ-TSTAT-011 tier checks", () => {
  assert.equal(tierProblem(DEFAULT_TIERS), null);
  assert.equal(tierProblem([]), null);
  assert.match(tierProblem([{ min: 5, max: 50, pct: 0.5 }])!, /start at 0/);
  assert.match(tierProblem([{ min: 0, max: 50, pct: 0.5 }, { min: 55, max: 100, pct: 0.4 }])!, /must start where/);
  assert.match(tierProblem([{ min: 0, max: 50, pct: 1.5 }])!, /rate/);
});
