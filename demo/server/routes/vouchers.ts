/**
 * Gift vouchers, live in the demo: buy one (pretend checkout), get the code
 * by email (demo inbox), check what's left, use it when booking online, and
 * use, undo, refund or cancel it from the dashboard.
 */
import { CLINIC_PHONE } from "@/core/policy";
import {
  MAX_SEND_AHEAD_DAYS, MAX_VOUCHER_MINOR, MIN_VOUCHER_MINOR, SUGGESTED_MINOR, VOUCHER_YEARS, displayCode, isExpired, looksMistyped, sendOnRefusal, totalsByTherapist, undoRefusal,
  useRefusal, voucherAmountMinor,
} from "@/core/vouchers";
import { euroText } from "@/core/hub-invoice";
import { PRACTITIONERS, practitionerById, practitionerName, priceMinor, typeById } from "../clinic";
import { type CheckoutSession, type Db, audit, stripeId } from "../db";
import { previewVoucher } from "../flows";
import { refundPayment } from "../stripe";
import { addEvent, balanceMinor, createVoucher, emailVoucher, findVoucher, today, voucherView } from "../vouchers";
import { fail, ok, route } from "../router";

const BY = "Demo Owner (Owner)";
const isEmail = (s: unknown): s is string => typeof s === "string" && /^\S+@\S+\.\S+$/.test(s.trim());

// ---- patients

route("GET", "/api/vouchers", () =>
  ok({ on: true, suggestedEUR: SUGGESTED_MINOR.map((m) => m / 100), minEUR: MIN_VOUCHER_MINOR / 100, maxEUR: MAX_VOUCHER_MINOR / 100, years: VOUCHER_YEARS, checkoutOn: true, balanceOn: true, maxSendAheadDays: MAX_SEND_AHEAD_DAYS }),
);

route("POST", "/api/vouchers/checkout", (db, now, req) => {
  const b = req.body ?? {};
  const amountMinor = voucherAmountMinor(b.amountEUR);
  if (!amountMinor) return fail(400, { error: `Choose a whole euro amount from €${MIN_VOUCHER_MINOR / 100} to €${MAX_VOUCHER_MINOR / 100}.` });
  if (!b.buyer?.name?.trim() || !isEmail(b.buyer?.email)) return fail(400, { error: "Enter your name and a valid email address." });
  const forThem = b.sendTo === "them";
  if (forThem && (!b.recipient?.name?.trim() || !isEmail(b.recipient?.email))) return fail(400, { error: "Enter the name and email of the person it's for." });
  if (forThem && b.sendOn) {
    const refusal = sendOnRefusal(String(b.sendOn), today(now));
    if (refusal) return fail(400, { error: refusal });
  }
  const v = createVoucher(db, now, {
    status: "pending", source: "online", amountMinor, buyerName: b.buyer.name.trim(), buyerEmail: b.buyer.email.trim(), recipientName: b.recipient?.name?.trim() || null,
    recipientEmail: forThem ? b.recipient.email.trim() : null, message: typeof b.message === "string" && b.message.trim() ? b.message.trim() : null, sendOn: forThem && b.sendOn ? String(b.sendOn) : null,
  });
  const id = stripeId(db, "cs_test").replace(/_d/, "_");
  const session: CheckoutSession = {
    id, status: "open", payment_status: "unpaid", account: null, amount: amountMinor, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 60_000).toISOString(),
    meta: {
      practitionerId: "", appointmentTypeId: "", businessId: "1", startsAtISO: "", voucherPurchaseId: v.id, returnUrl: `/vouchers/thanks?session_id=${encodeURIComponent(id)}`,
      patient: { firstName: v.buyerName.split(" ")[0], lastName: v.buyerName.split(" ").slice(1).join(" "), email: v.buyerEmail, phone: "", dateOfBirth: "" },
    },
  };
  v.sessionId = id;
  db.sessions.push(session);
  return ok({ url: `/demo-checkout?session=${encodeURIComponent(id)}` });
});

route("GET", "/api/vouchers/status", (db, now, req) => {
  const s = db.sessions.find((x) => x.id === req.url.searchParams.get("session_id"));
  const v = s && db.vouchers.find((x) => x.id === s.meta.voucherPurchaseId);
  if (!s || !v) return ok({ state: "not_found" });
  if (s.payment_status !== "paid") return ok({ state: "unpaid" });
  if (v.status !== "active") return ok({ state: "processing" });
  const scheduled = v.sendOn && v.sendOn > today(now) ? v.sendOn : null;
  return ok({ state: "issued", amountMinor: v.amountMinor, sentTo: v.recipientEmail ? [v.recipientEmail, v.buyerEmail] : [v.buyerEmail], emailed: !!v.emailedAt, forThem: !!v.recipientEmail, sendOn: scheduled });
});

route("POST", "/api/vouchers/balance", (db, now, req) => {
  const typed = String(req.body?.code ?? "");
  const v = findVoucher(db, typed);
  if (!v) return ok({ state: looksMistyped(typed) ? "mistyped" : "not_found" });
  const left = balanceMinor(v);
  const state = v.status === "cancelled" ? "cancelled" : isExpired(v.expiresOn, today(now)) ? "expired" : left <= 0 ? "used_up" : "active";
  return ok({ state, code: displayCode(v.code), balanceMinor: Math.max(0, left), expiresOn: v.expiresOn });
});

route("POST", "/api/vouchers/apply", (db, now, req) => {
  const typed = String(req.body?.code ?? "");
  const t = typeById(String(req.body?.appointmentTypeId ?? ""));
  if (!t) return fail(400, { ok: false, message: "Choose a treatment first." });
  const r = previewVoucher(db, now, typed, priceMinor(t.id));
  if (!r.ok) return ok({ ok: false, message: looksMistyped(typed) && /can't find/.test(r.message) ? "One of the characters in that code isn't right. Check it against the voucher and try again." : r.message });
  return ok({ ok: true, code: displayCode(r.voucher.code), appliedMinor: r.appliedMinor, dueMinor: r.dueMinor, balanceMinor: r.balanceMinor, expiresOn: r.voucher.expiresOn });
});

// ---- the dashboard

function overview(db: Db, now: number, period?: string | null) {
  const day = today(now);
  const live = db.vouchers.filter((v) => v.status === "active");
  const month = period && /^\d{4}-\d{2}$/.test(period) ? period : day.slice(0, 7);
  const uses = live.flatMap((v) => {
    const undone = new Set(v.events.map((e) => e.undoOf).filter(Boolean));
    return v.events
      .filter((e) => e.kind === "redeemed" && e.practitionerId && !undone.has(e.id) && (e.treatmentDay ?? e.at.slice(0, 10)).startsWith(month))
      .map((e) => ({ practitionerId: e.practitionerId!, practitionerName: practitionerName(e.practitionerId!), amountMinor: -e.amountMinor }));
  });
  const sixtyDaysAgo = new Date(now - 60 * 86_400_000).toISOString();
  return {
    today: day, canManage: true, practitioners: PRACTITIONERS.map((p) => ({ id: p.id, name: practitionerName(p.id) })),
    recent: db.vouchers
      .filter((v) => v.status !== "pending" && (v.events[0]?.at ?? "") >= sixtyDaysAgo)
      .sort((a, b) => (b.events[0]?.at ?? "").localeCompare(a.events[0]?.at ?? ""))
      .map((v) => ({ id: v.id, code: displayCode(v.code), status: v.status, source: v.source, amountMinor: v.amountMinor, balanceMinor: balanceMinor(v), createdAt: v.events[0]?.at ?? "", forName: v.recipientName ?? v.buyerName, emailed: !!v.emailedAt, emailError: null })),
    outstanding: {
      liveCount: live.filter((v) => !isExpired(v.expiresOn, day) && balanceMinor(v) > 0).length, liveMinor: live.filter((v) => !isExpired(v.expiresOn, day)).reduce((s, v) => s + Math.max(0, balanceMinor(v)), 0), expiredCount: 0, expiredMinor: 0,
    },
    period: { month, fromDay: `${month}-01`, toDay: month === day.slice(0, 7) ? day : `${month}-28`, therapists: totalsByTherapist(uses) },
  };
}

route("GET", "/api/admin/vouchers", (db, now, req) => {
  const code = req.url.searchParams.get("code");
  if (code) {
    const v = findVoucher(db, code);
    return v ? ok({ voucher: voucherView(db, v, now) }) : fail(404, { error: `No voucher with that code. Try one from the list below${db.vouchers[0] ? `, like ${displayCode(db.vouchers[0].code)}` : ""}.` });
  }
  return ok(overview(db, now, req.url.searchParams.get("period")));
});

route("POST", "/api/admin/vouchers", (db, now, req) => {
  const b = req.body ?? {};
  if (b.action === "import") return fail(403, { error: "Bringing vouchers over from another system isn't part of the demo." });
  const v = db.vouchers.find((x) => x.id === b.id);
  if (!v) return fail(404, { error: "That voucher isn't here any more." });
  const left = balanceMinor(v);
  const done = (extra: Record<string, unknown> = {}) => ok({ ok: true, voucher: voucherView(db, v, now), balanceMinor: balanceMinor(v), ...extra });

  if (b.action === "use") {
    const amount = Number(b.amountMinor);
    const refusal = useRefusal({ status: v.status, expiresOn: v.expiresOn, balanceMinor: left }, amount, today(now));
    if (refusal) return fail(409, { error: refusal });
    if (!practitionerById(String(b.practitionerId))) return fail(400, { error: "Choose the therapist." });
    addEvent(db, now, v, { kind: "redeemed", amountMinor: -amount, practitionerId: String(b.practitionerId), treatmentDay: typeof b.treatmentDay === "string" ? b.treatmentDay : today(now), byStaff: BY, note: typeof b.note === "string" ? b.note : "" });
    audit(db, now, { actor: "reception", by: BY, action: "voucher.used", amountMinor: amount });
    return done();
  }
  if (b.action === "undo") {
    const e = v.events.find((x) => x.id === b.eventId);
    const refusal = undoRefusal(e, v.events.some((x) => x.undoOf === b.eventId));
    if (refusal || !e) return fail(409, { error: refusal ?? "That line isn't on this voucher." });
    addEvent(db, now, v, { kind: "undone", amountMinor: -e.amountMinor, undoOf: e.id, byStaff: BY, note: typeof b.reason === "string" ? b.reason : "" });
    audit(db, now, { actor: "reception", by: BY, action: "voucher.undone", amountMinor: -e.amountMinor });
    return done();
  }
  if (b.action === "email") {
    if (b.email && !isEmail(b.email)) return fail(400, { error: "Enter a valid email address." });
    if (b.to === "recipient" && !v.recipientEmail && !b.email) return fail(400, { error: "There's no email for the person it's for. Type one in." });
    const sent = emailVoucher(db, now, v, { resend: true, only: b.to === "recipient" ? "recipient" : "buyer", to: b.email || undefined });
    return done({ sent });
  }
  if (b.action === "refund") {
    const amount = Number(b.amountMinor);
    if (!Number.isInteger(amount) || amount <= 0) return fail(400, { error: "Enter the amount to refund, more than €0." });
    if (amount > left) return fail(409, { error: `Only ${euroText(left)} is left on this voucher.` });
    if (v.paymentIntentId) refundPayment(db, now, v.paymentIntentId, amount, `Gift voucher refund: ${b.reason ?? ""}`.trim(), BY);
    addEvent(db, now, v, { kind: "refunded", amountMinor: -amount, byStaff: BY, note: typeof b.reason === "string" ? b.reason : "" });
    audit(db, now, { actor: "reception", by: BY, action: "voucher.refunded", amountMinor: amount });
    return done();
  }
  if (b.action === "cancel") {
    if (v.status === "cancelled") return fail(409, { error: "Already cancelled." });
    v.status = "cancelled";
    addEvent(db, now, v, { kind: "cancelled", amountMinor: 0, byStaff: BY, note: typeof b.reason === "string" ? b.reason : "" });
    audit(db, now, { actor: "reception", by: BY, action: "voucher.cancelled" });
    return done();
  }
  return fail(400, { error: `That isn't something the dashboard can do with a voucher. Call ${CLINIC_PHONE}.` });
});
