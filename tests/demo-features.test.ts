/**
 * The features brought over from the live system, through the demo's /api
 * routes: returning patients skipping the form, past payments, gift vouchers
 * bought and used, texts switched on, and the demo's navigation and guides.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { displayCode } from "@/core/vouchers";
import { ALL_GUIDES, resolveShots, shotIdsIn } from "@/core/guides/catalog";
import { plainText } from "@/core/guides/inline";
import { SHOTS } from "@/core/guides/shots";
import { HINTS, NAV, PORTFOLIO_URL, currentHref, hintFor } from "@/demo/nav";
import type { Db } from "@/demo/server/db";
import { availableTimes } from "@/demo/server/diary";
import { payCheckout } from "@/demo/server/flows";
import { dispatch } from "@/demo/server/router";
import { DEMO_PATIENT, DEMO_VOUCHER_IDS, RETURNING_PATIENT, seedDb } from "@/demo/server/seed";
import { balanceMinor } from "@/demo/server/vouchers";
import "@/demo/server/routes/patient";
import "@/demo/server/routes/staff";
import "@/demo/server/routes/reception";
import "@/demo/server/routes/money";
import "@/demo/server/routes/waitlist";
import "@/demo/server/routes/readonly";
import "@/demo/server/routes/vouchers";

const NOW = Date.parse("2026-11-10T09:15:00Z");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function call(db: Db, method: string, path: string, body?: unknown): { status: number; json: any } {
  const res = dispatch(db, NOW, method, new URL(path, "http://demo.local"), body);
  if (!res) throw new Error(`no route for ${method} ${path}`);
  return { status: res.status ?? 200, json: res.json };
}
const freeTime = (db: Db, practitionerId = "102", typeId = "202", n = 0) => availableTimes(db, practitionerId, typeId, "2026-11-16", "2026-11-27", NOW)[n];
const slot = (db: Db, n = 0) => ({ practitionerId: "102", appointmentTypeId: "202", businessId: "1", startsAtISO: freeTime(db, "102", "202", n) });
const sessionOf = (url: string) => new URL(url, "http://demo.local").searchParams.get("session")!;

function code(db: Db, purpose: "manage" | "returning", email: string) {
  call(db, "POST", purpose === "manage" ? "/api/manage/start" : "/api/returning-patient/start", { email });
  const c = db.outbox[0].text.match(/\b\d{6}\b/)![0];
  return call(db, "POST", purpose === "manage" ? "/api/manage/verify" : "/api/returning-patient/verify", { email, code: c });
}

describe("returning patients skip the details form", () => {
  test("no saved card: details on file, nothing to fill in, and the paid booking goes on their own record", () => {
    const db = seedDb(NOW);
    const hannah = db.patients.find((p) => p.email === RETURNING_PATIENT.email)!;
    const v = code(db, "returning", RETURNING_PATIENT.email);
    expect(v.json).toMatchObject({ card: null, missing: [], firstName: "Hannah", lastName: "Lynch" });
    const before = db.patients.length;
    const r = call(db, "POST", "/api/checkout", { ...slot(db), token: v.json.token, details: {} });
    expect(r.status).toBe(200);
    const s = sessionOf(r.json.url);
    payCheckout(db, NOW, s, "none");
    const out = call(db, "GET", `/api/booking-status?session_id=${s}`).json;
    expect(out.state).toBe("booked");
    expect(db.bookings[out.reference].clinikoPatientId).toBe(hannah.id);
    expect(db.patients.length).toBe(before);
  });

  test("a saved card is offered when there is one", () => {
    const db = seedDb(NOW);
    expect(code(db, "returning", DEMO_PATIENT.email).json).toMatchObject({ card: { brand: "visa", last4: "4242" }, missing: [], firstName: "Jack" });
  });

  test("only what the record lacks is asked, and the answer fills the gap without changing anything else", () => {
    const db = seedDb(NOW);
    const hannah = db.patients.find((p) => p.email === RETURNING_PATIENT.email)!;
    delete hannah.gp_name;
    const v = code(db, "returning", RETURNING_PATIENT.email);
    expect(v.json.missing).toEqual(["gpName"]);
    expect(call(db, "POST", "/api/checkout", { ...slot(db), token: v.json.token, details: {} }).json).toMatchObject({ code: "missing_details", missing: ["gpName"] });
    const r = call(db, "POST", "/api/checkout", { ...slot(db), token: v.json.token, details: { gpName: "Dr Walsh", address: "Somewhere else" } });
    payCheckout(db, NOW, sessionOf(r.json.url), "none");
    expect(hannah.gp_name).toBe("Dr Walsh");
    expect(hannah.address_1).toBe("3 Mill Lane");
  });

  test("an expired or made-up code session can't book", () => {
    const db = seedDb(NOW);
    expect(call(db, "POST", "/api/checkout", { ...slot(db), token: "nope", details: {} })).toMatchObject({ status: 401, json: { code: "session_expired" } });
  });

  test("a shared family email still gets the full form", () => {
    const db = seedDb(NOW);
    db.patients.push({ ...db.patients.find((p) => p.email === RETURNING_PATIENT.email)!, id: "2009997", first_name: "Sam" });
    expect(code(db, "returning", RETURNING_PATIENT.email)).toMatchObject({ status: 404, json: { noSavedCard: true } });
  });
});

describe("past payments on Manage a booking", () => {
  test("lists every payment newest first, with the card, extras and refunds", () => {
    const db = seedDb(NOW);
    const token = code(db, "manage", DEMO_PATIENT.email).json.token;
    const { payments } = call(db, "POST", "/api/manage/bookings", { token }).json;
    expect(payments.length).toBeGreaterThanOrEqual(5);
    expect([...payments].sort((a, b) => b.paidAtISO.localeCompare(a.paidAtISO))).toEqual(payments);
    expect(payments.every((p: { method: string }) => p.method === "Visa ending 4242")).toBe(true);
    expect(payments.some((p: { what: string; amountMinor: number }) => p.what === "Extra treatment: Shockwave" && p.amountMinor === 3000)).toBe(true);
    const refunded = payments.find((p: { cancelled: boolean }) => p.cancelled);
    expect(refunded.refundedMinor).toBe(refunded.amountMinor);
  });

  test("only that patient's payments are ever returned", () => {
    const db = seedDb(NOW);
    const jack = db.patients.find((p) => p.email === DEMO_PATIENT.email)!;
    const token = code(db, "manage", DEMO_PATIENT.email).json.token;
    const { payments } = call(db, "POST", "/api/manage/bookings", { token }).json;
    for (const p of payments) expect(db.bookings[p.appointmentId].clinikoPatientId).toBe(jack.id);
    expect(call(db, "POST", "/api/manage/bookings", { token: "nope" }).status).toBe(401);
  });
});

describe("gift vouchers: bought and used", () => {
  function buy(db: Db, amountEUR = 50) {
    const r = call(db, "POST", "/api/vouchers/checkout", { amountEUR, buyer: { name: "Orla Brennan", email: "orla@example.com" }, sendTo: "me", recipient: {} });
    expect(r.status).toBe(200);
    const s = sessionOf(r.json.url);
    payCheckout(db, NOW, s, "none");
    return { session: s, voucher: db.vouchers.at(-1)! };
  }

  test("they're on sale, usable at checkout and checkable", () => {
    expect(call(seedDb(NOW), "GET", "/api/vouchers").json).toMatchObject({ on: true, checkoutOn: true, balanceOn: true });
  });

  test("buying one charges the clinic's own account and emails the code", () => {
    const db = seedDb(NOW);
    const { session, voucher } = buy(db);
    expect(voucher.status).toBe("active");
    expect(balanceMinor(voucher)).toBe(5000);
    expect(db.payments.at(-1)).toMatchObject({ amount: 5000, account: null });
    expect(db.outbox[0]).toMatchObject({ to: "orla@example.com" });
    expect(db.outbox[0].text).toContain(displayCode(voucher.code));
    expect(call(db, "GET", `/api/vouchers/status?session_id=${session}`).json).toMatchObject({ state: "issued", amountMinor: 5000, emailed: true });
  });

  test("an unpaid voucher can't be used or looked up", () => {
    const db = seedDb(NOW);
    call(db, "POST", "/api/vouchers/checkout", { amountEUR: 50, buyer: { name: "Orla Brennan", email: "orla@example.com" }, sendTo: "me", recipient: {} });
    const pending = db.vouchers.at(-1)!;
    expect(pending.status).toBe("pending");
    expect(call(db, "POST", "/api/vouchers/balance", { code: pending.code }).json.state).toBe("not_found");
  });

  test("at online checkout the voucher comes off the fee and the card pays the rest", () => {
    const db = seedDb(NOW);
    const { voucher } = buy(db);
    const applied = call(db, "POST", "/api/vouchers/apply", { code: displayCode(voucher.code).toLowerCase(), appointmentTypeId: "202" }).json;
    expect(applied).toMatchObject({ ok: true, appliedMinor: 5000, dueMinor: 2000 });
    const r = call(db, "POST", "/api/checkout", { ...slot(db), patient: { firstName: "Test", lastName: "Patient", email: "v@example.com", phone: "087 555 0000", dateOfBirth: "1990-01-01" }, voucher: { code: voucher.code, appliedMinor: 5000 } });
    const s = sessionOf(r.json.url);
    expect(db.sessions.find((x) => x.id === s)!.amount).toBe(2000);
    // Set aside while the payment page is open, so it can't be spent twice.
    expect(call(db, "POST", "/api/vouchers/apply", { code: voucher.code, appointmentTypeId: "202" }).json.ok).toBe(false);
    payCheckout(db, NOW, s, "none");
    const ref = call(db, "GET", `/api/booking-status?session_id=${s}`).json.reference;
    expect(db.bookings[ref].voucher).toMatchObject({ amountMinor: 5000 });
    expect(db.bookings[ref].payments[0].amountMinor).toBe(2000);
    expect(balanceMinor(voucher)).toBe(0);
    expect(call(db, "POST", "/api/vouchers/balance", { code: voucher.code }).json.state).toBe("used_up");
  });

  test("a voucher that covers the whole fee books with no card payment; cancelling in time puts it back", () => {
    const db = seedDb(NOW);
    const { voucher } = buy(db, 100);
    const payments = db.payments.length;
    const r = call(db, "POST", "/api/checkout", { ...slot(db), patient: { firstName: "Test", lastName: "Patient", email: "whole@example.com", phone: "087 555 0000", dateOfBirth: "1990-01-01" }, voucher: { code: voucher.code, appliedMinor: 7000 } });
    expect(r.json).toMatchObject({ booked: true });
    expect(db.payments.length).toBe(payments);
    expect(balanceMinor(voucher)).toBe(3000);
    const token = code(db, "manage", "whole@example.com").json.token;
    const cancelled = call(db, "POST", "/api/manage/cancel", { token, appointmentId: r.json.appointmentId }).json;
    expect(cancelled).toMatchObject({ cancelled: true, voucherReturnedMinor: 7000, refundedMinor: 0 });
    expect(balanceMinor(voucher)).toBe(10000);
  });

  test("a saved-card booking can use a voucher too", () => {
    const db = seedDb(NOW);
    const { voucher } = buy(db);
    const token = code(db, "returning", DEMO_PATIENT.email).json.token;
    const r = call(db, "POST", "/api/charge-returning-patient", { ...slot(db), token, voucher: { code: voucher.code, appliedMinor: 5000 } });
    expect(r.json).toMatchObject({ status: "succeeded", voucherMinor: 5000 });
    expect(db.payments.at(-1)!.amount).toBe(2000);
  });

  test("a stale amount or a wrong code is refused before anything is charged", () => {
    const db = seedDb(NOW);
    const { voucher } = buy(db);
    const body = { ...slot(db), patient: { firstName: "Test", lastName: "Patient", email: "v@example.com", phone: "087 555 0000", dateOfBirth: "1990-01-01" } };
    expect(call(db, "POST", "/api/checkout", { ...body, voucher: { code: voucher.code, appliedMinor: 7000 } })).toMatchObject({ status: 409, json: { code: "voucher" } });
    expect(call(db, "POST", "/api/checkout", { ...body, voucher: { code: "NB-AAAA-AAAA-AAAA", appliedMinor: 5000 } }).status).toBe(409);
  });

  test("at the desk: use it, never more than is left, and undo a mistake", () => {
    const db = seedDb(NOW);
    const v = db.vouchers.find((x) => x.id === DEMO_VOUCHER_IDS.partUsed)!;
    expect(balanceMinor(v)).toBe(3000);
    expect(call(db, "GET", `/api/admin/vouchers?code=${displayCode(v.code)}`).json.voucher.balanceMinor).toBe(3000);
    expect(call(db, "POST", "/api/admin/vouchers", { id: v.id, action: "use", amountMinor: 3001, practitionerId: "101" }).status).toBe(409);
    const used = call(db, "POST", "/api/admin/vouchers", { id: v.id, action: "use", amountMinor: 1000, practitionerId: "101" }).json;
    expect(used.balanceMinor).toBe(2000);
    const line = used.voucher.events.find((e: { kind: string; amountMinor: number }) => e.kind === "redeemed" && e.amountMinor === -1000);
    expect(call(db, "POST", "/api/admin/vouchers", { id: v.id, action: "undo", eventId: line.id, reason: "wrong voucher" }).json.balanceMinor).toBe(3000);
    expect(call(db, "POST", "/api/admin/vouchers", { id: v.id, action: "undo", eventId: line.id }).status).toBe(409);
  });
});

describe("texts are switched on", () => {
  test("the waitlist and phone bookings both say texts are available", () => {
    const db = seedDb(NOW);
    expect(call(db, "GET", "/api/waitlist").json.smsAvailable).toBe(true);
    expect(call(db, "GET", "/api/admin/waitlist").json.smsAvailable).toBe(true);
    expect(call(db, "GET", "/api/admin/phone-booking").json).toMatchObject({ email: true, sms: true });
  });

  test("a phone booking's pay link can go by text: the date and the link, never the treatment", () => {
    const db = seedDb(NOW);
    const r = call(db, "POST", "/api/admin/phone-booking", { ...slot(db), channel: "sms", patient: { firstName: "Test", lastName: "Caller", email: "caller@example.com", phone: "087 123 4567", dateOfBirth: "1990-01-01" } });
    expect(r.status).toBe(200);
    const text = db.outbox[0];
    expect(text).toMatchObject({ channel: "sms", to: "087 123 4567" });
    expect(text.text).toContain(r.json.url);
    expect(text.text).not.toMatch(/physio/i);
    expect(call(db, "GET", "/api/admin/pay-links").json.links[0].channel).toBe("sms");
  });

  test("a waitlist offer goes by text to an Irish mobile, by email otherwise", () => {
    const db = seedDb(NOW);
    const [a, b] = db.waitlist;
    a.patient.phone = "087 123 4567";
    b.patient.phone = "+44 20 7946 0000";
    for (const e of [a, b]) {
      const time = call(db, "GET", `/api/admin/waitlist?times=${e.id}`).json.times[0];
      expect(call(db, "POST", "/api/admin/waitlist", { action: "offer", id: e.id, ...time }).status).toBe(200);
    }
    expect(a.offer!.channels).toEqual(["sms"]);
    expect(b.offer!.channels).toEqual(["email"]);
    expect(db.outbox.some((m) => m.channel === "sms" && m.to === "087 123 4567")).toBe(true);
  });
});

describe("the demo's navigation, hints and help centre", () => {
  const hrefs = NAV.flatMap((g) => g.items.map((i) => i.href));

  test("the menu lists each page once and every one exists", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(existsSync(join(process.cwd(), "app", h, "page.tsx")), h).toBe(true);
  });

  test("the current page is the longest match", () => {
    expect(currentHref("/")).toBe("/");
    expect(currentHref("/vouchers/balance")).toBe("/vouchers/balance");
    expect(currentHref("/dashboard/help/phone-booking")).toBe("/dashboard/help");
    expect(currentHref("/dashboard/appointments")).toBe("/dashboard/appointments");
    expect(currentHref("/pay/abc")).toBeNull();
  });

  test("it's called the help centre everywhere, and links back to the portfolio", () => {
    const labels = NAV.flatMap((g) => g.items.map((i) => i.label));
    expect(labels.filter((l) => /help centre/i.test(l))).toHaveLength(2);
    expect(labels.some((l) => /^(guides|help)$/i.test(l))).toBe(false);
    expect(PORTFOLIO_URL).toBe("https://cianmccaul.vercel.app");
  });

  test("every hint has a unique id, and its next step is a page in the menu", () => {
    expect(new Set(HINTS.map((h) => h.id)).size).toBe(HINTS.length);
    for (const h of HINTS) if (h.next) expect(hrefs, h.id).toContain(h.next.href);
    expect(hintFor("/manage")?.fills?.[0].value).toBe(DEMO_PATIENT.email);
    expect(hintFor("/dashboard/appointments")?.id).toBe("lookup");
    expect(hintFor("/dashboard/help/waitlist")?.id).toBe("staff-help");
    expect(hintFor("/rebook/abc")).toBeNull();
  });

  test("every guide picture was captured from the demo, exists, and is annotated", () => {
    const used = new Set(ALL_GUIDES.flatMap(shotIdsIn));
    expect(used.size).toBeGreaterThan(20);
    for (const id of used) {
      const s = SHOTS[id];
      expect(s, id).toBeTruthy();
      expect(existsSync(join(process.cwd(), "public", "guide-img", s.file)), s.file).toBe(true);
      for (const m of s.marks) {
        expect(m.label, id).toBeTruthy();
        expect(m.x >= 0 && m.y >= 0 && m.x + m.w <= 1.001 && m.y + m.h <= 1.001, id).toBe(true);
      }
    }
    // Nothing captured that no guide shows.
    expect(Object.keys(SHOTS).filter((id) => !used.has(id))).toEqual([]);
    for (const g of ALL_GUIDES) expect(Object.keys(resolveShots(g)).length, g.slug).toBeGreaterThan(0);
  });

  test("no guide mentions a video, and every picture has alt text", () => {
    for (const g of ALL_GUIDES) {
      expect(JSON.stringify(g)).not.toMatch(/video|loom/i);
      for (const b of g.blocks) {
        const refs = b.type === "steps" ? b.steps.flatMap((s) => (s.shot ? [s.shot] : [])) : b.type === "picture" ? [b.shot] : [];
        for (const r of refs) expect(plainText(r.alt).length, g.slug).toBeGreaterThan(20);
      }
    }
  });
});
