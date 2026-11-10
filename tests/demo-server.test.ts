/**
 * The demo's fake server: the same rules as production, checked end to end
 * through the /api routes the real screens call.
 */
import { describe, expect, test } from "vitest";
import { findClashes } from "@/core/machines";
import { REBOOK_DAYS } from "@/core/rebook";
import type { Db } from "@/demo/server/db";
import { availableTimes, liveAppointments } from "@/demo/server/diary";
import { handleCheckoutCompleted, payCheckout, tick, type Simulate } from "@/demo/server/flows";
import { dispatch } from "@/demo/server/router";
import { DEMO_PATIENT, seedDb } from "@/demo/server/seed";
import "@/demo/server/routes/patient";
import "@/demo/server/routes/staff";
import "@/demo/server/routes/reception";
import "@/demo/server/routes/money";
import "@/demo/server/routes/waitlist";
import "@/demo/server/routes/readonly";

// A Tuesday morning in Dublin.
const NOW = Date.parse("2026-11-10T09:15:00Z");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function call(db: Db, method: string, path: string, body?: unknown, now = NOW): { status: number; json: any } {
  const res = dispatch(db, now, method, new URL(path, "http://demo.local"), body);
  if (!res) throw new Error(`no route for ${method} ${path}`);
  return { status: res.status ?? 200, json: res.json };
}

const patient = (email: string) => ({ firstName: "Test", lastName: "Patient", email, phone: "087 555 0000", dateOfBirth: "1990-01-01" });

function firstFreeTime(db: Db, practitionerId = "102", typeId = "202") {
  return availableTimes(db, practitionerId, typeId, "2026-11-16", "2026-11-27", NOW)[0];
}

function checkout(db: Db, email: string, startsAtISO: string, practitionerId = "102", typeId = "202") {
  const r = call(db, "POST", "/api/checkout", { practitionerId, appointmentTypeId: typeId, businessId: "1", startsAtISO, patient: patient(email) });
  expect(r.status).toBe(200);
  return new URL(r.json.url, "http://demo.local").searchParams.get("session")!;
}

function pay(db: Db, sessionId: string, simulate: Simulate = "none") {
  payCheckout(db, NOW, sessionId, simulate);
  return call(db, "GET", `/api/booking-status?session_id=${sessionId}`).json;
}

describe("seed", () => {
  test("is the same for the same day, and made up", () => {
    const a = seedDb(NOW);
    const b = seedDb(NOW + 60_000);
    expect(a.appointments.length).toBe(b.appointments.length);
    expect(a.patients.every((p) => p.email.endsWith("@example.com"))).toBe(true);
  });

  test("has Jack's bookings, Laura's rebook and exactly one machine clash", () => {
    const db = seedDb(NOW);
    const jack = db.patients.find((p) => p.email === DEMO_PATIENT.email)!;
    expect(Object.values(db.bookings).filter((b) => b.clinikoPatientId === jack.id && b.status === "booked").length).toBeGreaterThanOrEqual(2);
    expect(db.rebooks.filter((r) => r.status === "open")).toHaveLength(1);
    const appts = liveAppointments(db).map((a) => ({ id: a.id, appointmentTypeId: a.appointment_type_id, startMs: Date.parse(a.starts_at), endMs: Date.parse(a.ends_at) }));
    expect(findClashes(appts)).toHaveLength(1);
  });
});

describe("online booking: pay, then book", () => {
  test("a paid checkout books the appointment and saves the card", () => {
    const db = seedDb(NOW);
    const t = firstFreeTime(db);
    const out = pay(db, checkout(db, "new@example.com", t));
    expect(out.state).toBe("booked");
    const rec = db.bookings[out.reference];
    expect(rec.payments[0]).toMatchObject({ kind: "full", amountMinor: 7000, destination: "therapist" });
    expect(availableTimes(db, "102", "202", "2026-11-16", "2026-11-27", NOW)).not.toContain(t);
  });

  test("the webhook is safe to run twice", () => {
    const db = seedDb(NOW);
    const s = checkout(db, "twice@example.com", firstFreeTime(db));
    pay(db, s);
    const before = db.appointments.length;
    const again = handleCheckoutCompleted(db, NOW, { id: `evt_${s}`, sessionId: s });
    expect(again.duplicate).toBe(true);
    expect(db.appointments.length).toBe(before);
  });

  test("time taken while paying: payment kept, a link to pick another time, refunded after 7 days if unused", () => {
    const db = seedDb(NOW);
    const out = pay(db, checkout(db, "unlucky@example.com", firstFreeTime(db)), "slot_taken");
    expect(out.state).toBe("rebook");
    const r = db.rebooks.find((x) => x.patient.email === "unlucky@example.com")!;
    const pi = db.payments.find((p) => p.id === r.paymentIntentId)!;
    expect(pi.amount_refunded).toBe(0);
    expect(db.outbox.some((m) => m.to === "unlucky@example.com" && m.text.includes(`/rebook/${r.token}`))).toBe(true);

    tick(db, NOW + (REBOOK_DAYS - 1) * 86_400_000);
    expect(r.status).toBe("open");
    tick(db, NOW + (REBOOK_DAYS + 1) * 86_400_000);
    expect(r.status).toBe("refunded");
    expect(pi.amount_refunded).toBe(pi.amount);
  });

  test("picking a new time on the rebook link books it on the same payment", () => {
    const db = seedDb(NOW);
    pay(db, checkout(db, "rebook@example.com", firstFreeTime(db)), "slot_taken");
    const r = db.rebooks.find((x) => x.patient.email === "rebook@example.com")!;
    const next = availableTimes(db, "102", "202", "2026-11-18", "2026-11-27", NOW)[0];
    expect(call(db, "POST", `/api/rebook/${r.token}`, { action: "book", startsAtISO: next }).status).toBe(200);
    expect(r.status).toBe("booked");
    expect(db.bookings[r.bookedAppointmentId!].payments[0].paymentIntentId).toBe(r.paymentIntentId);
  });

  test("diary down after retries: refunded in full, marked booking_failed", () => {
    const db = seedDb(NOW);
    const out = pay(db, checkout(db, "down@example.com", firstFreeTime(db)), "diary_down");
    expect(out).toEqual({ state: "refunded", reason: "booking_failed" });
    expect(db.appointments.some((a) => db.patients.find((p) => p.id === a.patient_id)?.email === "down@example.com")).toBe(false);
  });

  test("paused online booking refuses new checkouts", () => {
    const db = seedDb(NOW);
    call(db, "POST", "/api/admin/flags", { enabled: false, reason: "test" });
    const r = call(db, "POST", "/api/checkout", { practitionerId: "102", appointmentTypeId: "202", businessId: "1", startsAtISO: firstFreeTime(db), patient: patient("p@example.com") });
    expect(r.status).toBe(503);
  });

  test("the one shockwave machine is never double-booked by the Hub", () => {
    const db = seedDb(NOW);
    const t = availableTimes(db, "101", "205", "2026-11-16", "2026-11-27", NOW).find((x) => availableTimes(db, "104", "205", "2026-11-16", "2026-11-27", NOW).includes(x))!;
    expect(t).toBeTruthy();
    pay(db, checkout(db, "shock@example.com", t, "101", "205"));
    expect(availableTimes(db, "104", "205", "2026-11-16", "2026-11-27", NOW)).not.toContain(t);
  });
});

describe("cancelling: the 24-hour rule", () => {
  function signIn(db: Db) {
    call(db, "POST", "/api/manage/start", { email: DEMO_PATIENT.email });
    const code = db.outbox[0].text.match(/\b\d{6}\b/)![0];
    return call(db, "POST", "/api/manage/verify", { email: DEMO_PATIENT.email, code }).json.token as string;
  }

  test("more than 24 hours ahead: cancelled and refunded in full", () => {
    const db = seedDb(NOW);
    const token = signIn(db);
    const later = call(db, "POST", "/api/manage/bookings", { token }).json.bookings.find((b: { startsAtISO: string }) => Date.parse(b.startsAtISO) - NOW > 24 * 3_600_000);
    const r = call(db, "POST", "/api/manage/cancel", { token, appointmentId: later.appointmentId });
    expect(r.json).toMatchObject({ cancelled: true, late: false, refundedMinor: later.paidMinor ?? r.json.refundedMinor });
    expect(r.json.refundedMinor).toBeGreaterThan(0);
  });

  test("inside 24 hours: cancelled, nothing refunded", () => {
    const db = seedDb(NOW);
    const token = signIn(db);
    const soon = call(db, "POST", "/api/manage/bookings", { token }).json.bookings.find((b: { startsAtISO: string }) => Date.parse(b.startsAtISO) - NOW < 24 * 3_600_000);
    const r = call(db, "POST", "/api/manage/cancel", { token, appointmentId: soon.appointmentId });
    expect(r.json).toMatchObject({ cancelled: true, late: true, refundedMinor: 0 });
  });
});

describe("reception", () => {
  test("refunds never go above what was paid", () => {
    const db = seedDb(NOW);
    const b = Object.values(db.bookings).find((x) => x.status === "booked" && x.payments.length === 1 && x.startsAtISO > new Date(NOW).toISOString())!;
    const r = call(db, "POST", "/api/admin/action", { appointmentId: b.appointmentId, action: "refund", amountMinor: b.payments[0].amountMinor + 1, reason: "test" });
    expect(r.status).toBe(409);
  });

  test("a phone booking's pay link holds the time; paying it books the appointment", () => {
    const db = seedDb(NOW);
    const t = firstFreeTime(db);
    const link = call(db, "POST", "/api/admin/phone-booking", { practitionerId: "102", appointmentTypeId: "202", businessId: "1", startsAtISO: t, patient: patient("caller@example.com"), channel: "email" });
    expect(link.status).toBe(200);
    expect(call(db, "POST", "/api/checkout", { practitionerId: "102", appointmentTypeId: "202", businessId: "1", startsAtISO: t, patient: patient("other@example.com") }).status).toBe(409);
    const token = link.json.url.split("/").pop();
    const session = new URL(call(db, "POST", `/api/pay/${token}`, {}).json.url, "http://demo.local").searchParams.get("session")!;
    expect(pay(db, session).state).toBe("booked");
    expect(call(db, "GET", "/api/admin/pay-links").json.links[0].status).toBe("paid");
  });

  test("a waitlist offer that's paid for takes them off the list", () => {
    const db = seedDb(NOW);
    const entry = db.waitlist[0];
    const time = call(db, "GET", `/api/admin/waitlist?times=${entry.id}`).json.times[0];
    expect(call(db, "POST", "/api/admin/waitlist", { action: "offer", id: entry.id, ...time }).status).toBe(200);
    const link = db.payLinks.find((l) => l.waitlistEntryId === entry.id)!;
    const session = new URL(call(db, "POST", `/api/pay/${link.token}`, {}).json.url, "http://demo.local").searchParams.get("session")!;
    pay(db, session);
    expect(entry.status).toBe("filled");
  });

  test("view-only areas answer with sample data; the KPI report runs on the demo diary", () => {
    const db = seedDb(NOW);
    for (const path of ["/api/admin/vouchers", "/api/staff/tasks", "/api/admin/shifts", "/api/staff/team", "/api/admin/email-templates", "/api/staff/guides", "/api/admin/therapist-stats"]) {
      expect(call(db, "GET", path).status).toBe(200);
    }
    const k = call(db, "GET", "/api/admin/kpis").json.data;
    expect(k.therapists.length).toBeGreaterThan(0);
    expect(k.cards.length).toBeGreaterThan(0);
  });
});
