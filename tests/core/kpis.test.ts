import { test } from "vitest";
import assert from "node:assert/strict";
import { computeKpis, dublinWeekdayHour, isNewPatientType, kpiPresets, pct, referralBucket, type KpiAppointment } from "../../core/kpis.ts";

const from = "2026-10-01";
const to = "2026-10-31";
const fromMs = Date.parse("2026-09-30T23:00:00Z"); // Irish midnight, summer time
const toMs = Date.parse("2026-11-01T00:00:00Z"); // Irish midnight, winter time
const nowMs = Date.parse("2026-10-20T12:00:00Z");

let n = 0;
const appt = (o: Partial<KpiAppointment>): KpiAppointment => ({
  id: String(++n),
  startsAt: "2026-10-06T09:00:00Z",
  practitionerId: "A",
  patientId: "p1",
  typeName: "Physiotherapy - Return Patient (30mins)",
  cancelledAt: null,
  didNotArrive: false,
  ...o,
});

const run = (appointments: KpiAppointment[], extra: Partial<Parameters<typeof computeKpis>[0]> = {}) =>
  computeKpis({ from, to, fromMs, toMs, nowMs, appointments, invoices: [], online: [], newPatientReferrals: [], ...extra });

test("REQ-KPI-001 attended, upcoming, cancelled (late), no-shows; only the period counts", () => {
  const r = run([
    appt({}),
    appt({ startsAt: "2026-10-27T10:00:00Z" }), // upcoming
    appt({ startsAt: "2026-10-07T10:00:00Z", cancelledAt: "2026-10-07T01:00:00Z" }), // late
    appt({ startsAt: "2026-10-08T10:00:00Z", cancelledAt: "2026-10-01T10:00:00Z" }), // in good time
    appt({ startsAt: "2026-10-09T10:00:00Z", didNotArrive: true, patientId: "p2" }),
    appt({ startsAt: "2026-11-05T10:00:00Z", patientId: "p9" }), // after the period: not counted
  ]);
  assert.equal(r.clinic.appointments, 5);
  assert.equal(r.clinic.attended, 1);
  assert.equal(r.clinic.upcoming, 1);
  assert.equal(r.clinic.cancelled, 2);
  assert.equal(r.clinic.lateCancelled, 1);
  assert.equal(r.clinic.noShows, 1);
  assert.equal(r.clinic.patients, 2, "p1 and p2; cancelled-only and out-of-period don't add patients");
});

test("REQ-KPI-002 new vs returning by appointment type, per therapist and clinic-wide", () => {
  const r = run([
    appt({ patientId: "p1", typeName: "Physiotherapy - New Patient (45mins)" }),
    appt({ patientId: "p1", startsAt: "2026-10-13T09:00:00Z", practitionerId: "B" }),
    appt({ patientId: "p2" }),
    appt({ patientId: "p3", typeName: "Scoliosis - New Patient", practitionerId: "B" }),
  ]);
  assert.equal(r.clinic.newPatients, 2);
  assert.equal(r.clinic.returningPatients, 1);
  assert.equal(r.byPractitioner.A.newPatients, 1);
  assert.equal(r.byPractitioner.B.newPatients, 1, "p3");
  assert.equal(r.byPractitioner.B.returningPatients, 1, "p1 was returning for B");
  assert.ok(isNewPatientType("Women's Health Physio - New patient (60mins)"));
  assert.ok(!isNewPatientType("Running Assessment"));
});

test("REQ-KPI-003 booked again within 6 weeks of the last visit, cancelled ones don't count", () => {
  const r = run([
    appt({ patientId: "p1", startsAt: "2026-10-06T09:00:00Z" }),
    appt({ patientId: "p1", startsAt: "2026-11-10T09:00:00Z" }), // 5 weeks later: yes
    appt({ patientId: "p2", startsAt: "2026-10-06T09:00:00Z" }),
    appt({ patientId: "p2", startsAt: "2026-10-30T09:00:00Z", cancelledAt: "2026-10-20T09:00:00Z" }), // cancelled: no
    appt({ patientId: "p3", startsAt: "2026-10-02T09:00:00Z" }),
    appt({ patientId: "p3", startsAt: "2026-12-30T09:00:00Z" }), // too late: no
    appt({ patientId: "p4", startsAt: "2026-10-28T09:00:00Z" }), // hasn't happened: not in the "of"
  ]);
  assert.equal(r.clinic.bookedAgainOf, 3);
  assert.equal(r.clinic.bookedAgain, 1);
  assert.equal(pct(r.clinic.bookedAgain, r.clinic.bookedAgainOf), 33.3);
  assert.equal(pct(1, 0), null);
});

test("REQ-KPI-004 revenue, busiest times (Irish time) and referral sources", () => {
  const r = run([appt({ startsAt: "2026-10-06T09:00:00Z" })], {
    invoices: [
      { practitionerId: "A", totalMinor: 8500, issueDate: "2026-10-06" },
      { practitionerId: "A", totalMinor: -8500, issueDate: "2026-10-07" },
      { practitionerId: "B", totalMinor: 7500, issueDate: "2026-10-08" },
    ],
    online: [{ practitionerId: "A", netMinor: 9000, at: "2026-10-06T09:00:00Z" }],
    newPatientReferrals: ["Google", "Google — search", "Friend or family — Mary", null, ""],
  });
  assert.equal(r.clinic.invoicedMinor, 7500);
  assert.equal(r.clinic.invoices, 2, "credit notes aren't counted as invoices");
  assert.equal(r.byPractitioner.A.onlineMinor, 9000);
  assert.deepEqual(dublinWeekdayHour("2026-10-06T09:00:00Z"), { weekday: 1, hour: 10 }, "Tue 10:00 in summer time");
  assert.deepEqual(dublinWeekdayHour("2026-11-02T09:00:00Z"), { weekday: 0, hour: 9 }, "Mon 09:00 in winter time");
  assert.equal(r.busiest[1][10], 1);
  assert.deepEqual(r.referrals, [
    { source: "Google", count: 2 },
    { source: "Not given", count: 2 },
    { source: "Friend or family", count: 1 },
  ]);
  assert.equal(referralBucket("  "), "Not given");
});

test("REQ-KPI-005 periods", () => {
  const p = Object.fromEntries(kpiPresets("2026-10-20").map((x) => [x.id, [x.from, x.to]]));
  assert.deepEqual(p.week, ["2026-10-19", "2026-10-20"]);
  assert.deepEqual(p.month, ["2026-10-01", "2026-10-20"]);
  assert.deepEqual(p["last-month"], ["2026-09-01", "2026-09-30"]);
  assert.deepEqual(p["3-months"], ["2026-08-01", "2026-10-20"]);
  const jan = Object.fromEntries(kpiPresets("2027-01-05").map((x) => [x.id, [x.from, x.to]]));
  assert.deepEqual(jan["last-month"], ["2026-12-01", "2026-12-31"]);
  assert.deepEqual(jan["3-months"], ["2026-11-01", "2027-01-05"]);
});
