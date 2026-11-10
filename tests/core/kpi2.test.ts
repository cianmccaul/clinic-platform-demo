import { test } from "vitest";
import assert from "node:assert/strict";
import {
  addDays,
  attendance,
  buildAvailability,
  detectSundayZero,
  feePerAttendedHour,
  midnight,
  missedRate,
  modalityOf,
  movement,
  baseline,
  northStar,
  rebookRate,
  utilisation,
  weekStats,
  forwardGaps,
  type Appt,
  type Availability,
  type KpiInput,
} from "../../core/kpi2.ts";
import { buildReport } from "../../core/kpi2-report.ts";

// Sarah works Mon–Fri 09:00–17:00 (Cliniko numbering with Sunday = 0).
const av: Availability[] = [1, 2, 3, 4, 5].map((d) => ({ practitionerId: "A", dayOfWeek: d, ranges: [[540, 1020]] }));
let n = 0;
const at = (day: string, hhmm: string) => new Date(midnight(day) + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000).toISOString();
const appt = (day: string, hhmm: string, o: Partial<Appt> = {}): Appt => {
  const s = at(day, hhmm);
  return {
    id: String(++n),
    patientId: `p${n}`,
    practitionerId: "A",
    typeName: "Physiotherapy - Return Patient",
    modality: "physio",
    startsAt: s,
    endsAt: new Date(Date.parse(s) + 60 * 60_000).toISOString(),
    createdAt: new Date(Date.parse(s) - 7 * 86_400_000).toISOString(),
    cancelledAt: null,
    didNotArrive: false,
    priceMinor: 8000,
    ...o,
  };
};

test("REQ-KPI2-001 treatment types from Cliniko categories", () => {
  assert.equal(modalityOf("Women's Health Physiotherapy"), "physio");
  assert.equal(modalityOf("Scoliosis Specialist Physiotherapy"), "physio");
  assert.equal(modalityOf("High Intensity Laser (Physio)"), "physio");
  assert.equal(modalityOf("Massage", "Reflexology"), "massage");
  assert.equal(modalityOf("Osteopathy", "Craniosacral Therapy"), "osteopathy");
  assert.equal(modalityOf("Acupuncture", "Reiki"), "acupuncture");
  assert.equal(modalityOf("3. Massage"), "massage");
  assert.equal(modalityOf(null, "Room hire"), "other");
});

test("REQ-KPI2-002 working hours, utilisation, attendance and the headline number for a week", () => {
  const mon = "2026-10-12";
  const appts = [
    appt(mon, "09:00"),
    appt(mon, "10:00", { didNotArrive: true }),
    appt(addDays(mon, 1), "09:00"),
    appt(addDays(mon, 1), "11:00", { cancelledAt: at(addDays(mon, 1), "08:00") }), // late cancel
    appt(addDays(mon, 2), "12:00", { cancelledAt: at(mon, "08:00") }), // in good time
    appt(addDays(mon, 3), "18:00"), // outside working hours: value counts, utilisation doesn't
  ];
  const input: KpiInput = { nowMs: Date.parse("2026-10-20T12:00:00Z"), appts, availabilities: av, unavailable: [], extra: [] };
  assert.equal(detectSundayZero(av, appts), true);
  const a = buildAvailability(input);
  const s = weekStats(input, mon, { kind: "clinic" }, a);
  assert.equal(s.availableMin, 5 * 8 * 60);
  assert.equal(s.booked, 4);
  assert.equal(s.attended, 3);
  assert.equal(s.noShows, 1);
  assert.equal(s.lateCancels, 1);
  assert.equal(s.cancels, 2);
  assert.equal(s.due, 5);
  assert.equal(s.bookedMin, 180, "the 18:00 one is outside hours");
  assert.equal(s.attendedMin, 120);
  assert.equal(s.valueMinor, 24000);
  assert.equal(utilisation(s), 180 / 2400);
  assert.equal(attendance(s), 120 / 180);
  assert.equal(missedRate(s), 2 / 5);
  const ns = northStar(s)!;
  assert.ok(Math.abs(ns - feePerAttendedHour(s)! * utilisation(s)! * attendance(s)!) < 1e-6, "headline = fee/hour × how full × attendance");
});

test("REQ-KPI2-003 a bank holiday with nothing booked is closed; unavailable time comes off; extra time is added", () => {
  const mon = "2026-10-26"; // October bank holiday
  const input: KpiInput = {
    nowMs: Date.parse("2026-11-03T12:00:00Z"),
    appts: [appt("2026-10-27", "09:00")],
    availabilities: av,
    unavailable: [{ practitionerId: "A", startsAt: at("2026-10-28", "09:00"), endsAt: at("2026-10-28", "13:00") }],
    extra: [{ practitionerId: "A", startsAt: at("2026-10-31", "10:00"), endsAt: at("2026-10-31", "12:00") }],
  };
  const s = weekStats(input, mon, { kind: "clinic" }, buildAvailability(input));
  assert.equal(s.availableMin, (4 * 8 - 4 + 2) * 60);
});

test("REQ-KPI2-004 rebooked means the next visit was booked by 48 hours after; usual vs not", () => {
  const mon = "2026-10-12";
  const first = appt(mon, "09:00", { patientId: "x" });
  const nextOk = appt("2026-10-19", "09:00", { patientId: "x", createdAt: at(mon, "10:30") });
  const later = appt(mon, "11:00", { patientId: "y" });
  const nextLate = appt("2026-10-26", "09:00", { patientId: "y", createdAt: at("2026-10-16", "09:00") });
  const input: KpiInput = { nowMs: Date.parse("2026-10-20T12:00:00Z"), appts: [first, nextOk, later, nextLate], availabilities: av, unavailable: [], extra: [] };
  const s = weekStats(input, mon, { kind: "clinic" }, buildAvailability(input));
  assert.equal(s.attended, 2);
  assert.equal(rebookRate(s), 0.5);
  const b = baseline([0.7, 0.72, 0.69, 0.71]);
  assert.equal(movement(0.705, b), "normal");
  assert.equal(movement(0.5, b), "down");
  assert.equal(movement(0.5, null), "unknown");
});

test("REQ-KPI2-005 free time ahead, and the whole report reads without gaps", () => {
  const now = Date.parse("2026-10-20T08:00:00Z"); // Tue 09:00 Irish
  const appts: Appt[] = [];
  for (let w = 12; w >= 0; w--) {
    const mon = addDays("2026-10-19", -7 * w);
    for (let d = 0; d < 5; d++) for (const t of ["09:00", "10:00", "11:00", "14:00", "15:00"]) appts.push(appt(addDays(mon, d), t, { patientId: `q${(d * 7 + w) % 40}` }));
  }
  const input: KpiInput = { nowMs: now, appts, availabilities: av, unavailable: [], extra: [] };
  const g = forwardGaps(input, buildAvailability(input), 7);
  assert.equal(g.length, 7);
  assert.ok(g[0].availableMin <= 8 * 60);
  const r = buildReport(input, { targetMinor: 2_000_000 });
  assert.equal(r.cards.length, 6);
  const text = JSON.stringify(r);
  assert.ok(!/NaN|undefined|Infinity/.test(text), "no broken numbers in the report");
  assert.ok(r.summary.length >= 1 && r.summary.length <= 4);
  assert.equal(r.week.from, "2026-10-12");
  assert.ok(r.heat.headline.length > 10);
  assert.ok(r.cards.every((c) => c.meaning && c.confidence.text));
});
