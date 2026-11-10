/** Reception's routes: online bookings, appointments, patient search, pay links, the booking switch and the activity log. */
import type { BookingRecord } from "@/lib/bookings";
import { euro, formatDublin } from "@/core/policy";
import { parseLookupQuery, suggestedKind } from "@/core/patient-lookup";
import { BUSINESS, practitionerName, priceMinor, typeById } from "../clinic";
import { type Appointment, type Db, audit, feeNetPaidMinor, netPaidMinor, paidMinor, paidOnline, refundedMinor } from "../db";
import { cancelAppointment, getAppointment, liveAppointments } from "../diary";
import { cancelBooking, factsFor, mail, moveBooking, rebookChoose, rebookRefund, recordForAppointment } from "../flows";
import { charge, entryFor, refundUpTo } from "../stripe";
import { fail, ok, route } from "../router";

const BY = "Demo Owner (Owner)";
const plain = (n?: string) => (n ?? "").replace(/^\d+\.\s*/, "");

function bookingRow(db: Db, b: BookingRecord) {
  const a = getAppointment(db, b.appointmentId);
  const full = priceMinor(b.appointmentTypeId);
  const card = db.savedCards[b.clinikoPatientId];
  return {
    appointmentId: b.appointmentId,
    patientName: b.patientName ?? "",
    patientEmail: b.patientEmail ?? "",
    appointmentTypeName: b.appointmentTypeName ?? "Appointment",
    practitionerName: practitionerName(b.practitionerId),
    startsAtISO: b.startsAtISO,
    status: b.status,
    cancelledBy: b.cancelledBy ?? null,
    lateCancellation: !!b.lateCancellation,
    didNotArrive: !!a?.did_not_arrive,
    paidMinor: paidMinor(b),
    refundedMinor: refundedMinor(b),
    netPaidMinor: netPaidMinor(b),
    fullPriceMinor: full,
    owedMinor: b.status === "booked" ? Math.max(0, full - feeNetPaidMinor(b)) : 0,
    hasSavedCard: !!card,
    voucher: null,
    payments: b.payments.map((p) => ({ kind: p.kind, amountMinor: p.amountMinor, refundedMinor: p.refundedMinor, destination: p.destination, ref: p.paymentIntentId, at: p.at })),
  };
}

route("GET", "/api/admin/bookings", (db, _now, req) => {
  const date = req.url.searchParams.get("date");
  const email = req.url.searchParams.get("email");
  let records = Object.values(db.bookings).filter((b) => b.payments.length > 0);
  if (email) records = records.filter((b) => (b.patientEmail ?? "").toLowerCase() === email.trim().toLowerCase());
  else if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date(iso));
    records = records.filter((b) => day(b.startsAtISO) === date);
  } else return fail(400, { error: "date (YYYY-MM-DD) or email is required" });
  return ok({ bookings: records.map((b) => bookingRow(db, b)).sort((a, b) => a.startsAtISO.localeCompare(b.startsAtISO)) });
});

route("POST", "/api/admin/action", (db, now, req) => {
  const { appointmentId, action, amountMinor, reason } = req.body ?? {};
  const b = db.bookings[String(appointmentId)];
  if (!b) return fail(404, { error: "No online booking record for that appointment." });
  const card = db.savedCards[b.clinikoPatientId];

  if (action === "cancel_refund" || action === "cancel_keep" || action === "cancel_late_fee") {
    if (b.status === "cancelled") return fail(409, { error: "Already cancelled." });
    const r = cancelBooking(db, now, b, "clinic", action === "cancel_refund" ? "refund" : action === "cancel_keep" ? "keep" : "charge_full", BY);
    const message = r.refundedMinor ? `Cancelled and refunded ${euro(r.refundedMinor)}.` : r.lateFeeMinor ? `Cancelled; late fee of ${euro(r.lateFeeMinor)} charged.` : "Cancelled, nothing refunded.";
    return ok({ ok: true, message });
  }

  if (action === "refund") {
    const net = netPaidMinor(b);
    if (net <= 0) return fail(409, { error: "Nothing left to refund." });
    const want = amountMinor ?? net;
    if (want > net) return fail(409, { error: `You can refund at most ${euro(net)} on this booking.` });
    const refunded = refundUpTo(db, now, b, want, `Refunded by the clinic: ${reason ?? ""}`.trim(), BY);
    getAppointment(db, b.appointmentId)?.notes.push(`${refunded < net ? "Part refund" : "Refund"} of ${euro(refunded)} by ${BY}. Reason: ${reason ?? ""}`);
    if (b.patientEmail) mail(db, now, b.patientEmail, "refund", { ...factsFor(b), amount: euro(refunded) });
    audit(db, now, { actor: "reception", by: BY, action: "refund", appointmentId: b.appointmentId, amountMinor: refunded });
    return ok({ ok: true, message: `Refunded ${euro(refunded)}.`, amountMinor: refunded });
  }

  if (action === "charge_extra") {
    if (b.status === "cancelled") return fail(409, { error: "This booking is cancelled." });
    if (!card) return fail(402, { error: "There's no saved card for this practitioner's account, so it can't be charged here. Take it on the card machine.", code: "declined" });
    const pi = charge(db, now, { practitionerId: b.practitionerId, amountMinor, description: "Extra treatment", patientId: b.clinikoPatientId, card });
    b.payments.push(entryFor(pi, "extra", reason));
    if (b.patientEmail) mail(db, now, b.patientEmail, "extra_charge", { ...factsFor(b), amount: euro(amountMinor), extra: reason });
    audit(db, now, { actor: "reception", by: BY, action: "charge.extra", appointmentId: b.appointmentId, amountMinor });
    return ok({ ok: true, message: `Charged ${euro(amountMinor)} for ${reason}.`, amountMinor });
  }

  // charge_no_show / charge_balance
  if (b.status === "cancelled") return fail(409, { error: "This booking is cancelled." });
  if (new Date(b.startsAtISO).getTime() > now) return fail(409, { error: "You can only charge this once the appointment time has passed." });
  const owed = priceMinor(b.appointmentTypeId) - feeNetPaidMinor(b);
  if (owed <= 0) return fail(409, { error: "Nothing owed — already paid in full." });
  if (!card) return fail(402, { error: "There's no saved card for this patient. Take it on the card machine." });
  const kind = action === "charge_no_show" ? "no_show" : "balance";
  const pi = charge(db, now, { practitionerId: b.practitionerId, amountMinor: owed, description: kind === "no_show" ? "Missed appointment" : "Balance", patientId: b.clinikoPatientId, card });
  b.payments.push(entryFor(pi, kind));
  if (b.patientEmail) mail(db, now, b.patientEmail, kind === "no_show" ? "no_show" : "balance", { ...factsFor(b), amount: euro(owed) });
  audit(db, now, { actor: "reception", by: BY, action: `charge.${kind}`, appointmentId: b.appointmentId, amountMinor: owed });
  return ok({ ok: true, message: `Charged ${euro(owed)}.`, amountMinor: owed });
});

route("GET", "/api/admin/flags", (db) => ok({ onlineBooking: { enabled: db.flags.onlineBooking, source: "dashboard", reason: db.flags.reason }, canRedirect: false }));
route("POST", "/api/admin/flags", (db, now, req) => {
  db.flags = { onlineBooking: !!req.body?.enabled, reason: req.body?.reason };
  audit(db, now, { actor: "reception", by: BY, action: "flag.online_booking", note: db.flags.onlineBooking ? "Online booking on" : `Online booking paused${db.flags.reason ? `: ${db.flags.reason}` : ""}` });
  return ok({ onlineBooking: { enabled: db.flags.onlineBooking, source: "dashboard", reason: db.flags.reason, changedAt: new Date(now).toISOString() }, canRedirect: false });
});

route("GET", "/api/admin/audit", (db, _now, req) => {
  const limit = Math.min(500, Number(req.url.searchParams.get("limit") ?? 100) || 100);
  return ok({ events: db.audit.slice(0, limit).map((e) => ({ ts: e.at, actor: e.actor, by: e.by, action: e.action, appointmentId: e.appointmentId, amountMinor: e.amountMinor, note: e.note })) });
});

/** The daily reconciliation, run on demand: do the diary and the payments agree? */
route("POST", "/api/cron/reconcile", (db, now) => {
  const issues: { severity: "urgent" | "check"; title: string; detail: string }[] = [];
  for (const b of Object.values(db.bookings)) {
    const a = getAppointment(db, b.appointmentId);
    if (b.status === "booked" && a?.cancelled_at) issues.push({ severity: "check", title: "Cancelled in the diary, still paid", detail: `${b.patientName}, ${formatDublin(b.startsAtISO)}: refund if needed.` });
  }
  for (const r of db.rebooks.filter((x) => x.status === "open")) issues.push({ severity: "check", title: "Paid, waiting for a new time", detail: `${r.patient.firstName} ${r.patient.lastName}: refunded automatically on ${formatDublin(r.refundBy)} if not rebooked.` });
  audit(db, now, { actor: "system", action: "reconcile", note: issues.length ? `${issues.length} to check` : "All matched" });
  return ok({ issues });
});

route("GET", "/api/admin/pay-links", (db) =>
  ok({
    links: [...db.payLinks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((l) => ({
      id: l.id, status: l.status === "open" ? "pending" : l.status, createdAt: l.createdAt, expiresAt: l.expiresAt, channel: l.sentTo.phone && !l.sentTo.email ? "sms" : "email",
      patientName: `${l.patient.firstName} ${l.patient.lastName}`, patientEmail: l.patient.email, appointmentTypeName: plain(l.appointmentTypeName),
      practitionerName: practitionerName(l.practitionerId), startsAtISO: l.startsAtISO, amountMinor: l.amountMinor, appointmentId: l.appointmentId ?? null,
    })),
    approvals: [],
  }),
);
route("POST", "/api/admin/pay-links", (db, now, req) => {
  const l = db.payLinks.find((x) => x.id === req.body?.id);
  if (!l || l.status !== "open") return fail(409, { error: "That link has already closed." });
  l.status = "cancelled";
  db.holds = db.holds.filter((h) => h.owner !== `paylink:${l.id}`);
  audit(db, now, { actor: "reception", by: BY, action: "pay_link.cancelled" });
  return ok({ ok: true });
});

// ---- Appointments: any patient's upcoming appointments, move or cancel, and rebooks waiting

route("GET", "/api/admin/appointments", (db, now, req) => {
  if (req.url.searchParams.get("rebooks") === "1") {
    return ok({
      rebooks: db.rebooks.filter((r) => r.status === "open").map((r) => {
        const p = db.patients.find((x) => x.id === r.clinikoPatientId);
        return {
          id: r.id, patientName: `${r.patient.firstName} ${r.patient.lastName}`, patientEmail: r.patient.email, patientPhone: p?.phone ?? "",
          practitionerName: r.practitionerName, appointmentTypeName: plain(r.appointmentTypeName), amountMinor: r.amountMinor, originalStartsAtISO: r.originalStartsAtISO,
          refundBy: r.refundBy, businessId: r.businessId, practitionerId: r.practitionerId, appointmentTypeId: r.appointmentTypeId,
        };
      }),
    });
  }
  const pid = req.url.searchParams.get("patientId") ?? "";
  const patient = db.patients.find((p) => p.id === pid);
  if (!patient) return fail(400, { error: "patientId is required" });
  const nowIso = new Date(now).toISOString();
  const rows = liveAppointments(db)
    .filter((a) => a.patient_id === pid && a.starts_at > nowIso)
    .sort((x, y) => x.starts_at.localeCompare(y.starts_at))
    .map((a) => {
      const rec = db.bookings[a.id];
      const t = typeById(a.appointment_type_id)!;
      return {
        appointmentId: a.id, startsAtISO: a.starts_at, durationMinutes: t.duration_in_minutes, practitionerId: a.practitioner_id, practitionerName: practitionerName(a.practitioner_id),
        appointmentTypeId: t.id, appointmentTypeName: plain(t.name), businessId: BUSINESS.id,
        hub: rec && paidOnline(rec) ? { netPaidMinor: netPaidMinor(rec), voucherMinor: 0, owedMinor: Math.max(0, priceMinor(t.id) - feeNetPaidMinor(rec)) } : null,
      };
    });
  audit(db, now, { actor: "reception", by: BY, action: "appointments.list" });
  return ok({ patient: { id: pid, name: `${patient.first_name} ${patient.last_name}`, email: patient.email }, hasSavedCard: !!db.savedCards[pid], appointments: rows });
});

route("POST", "/api/admin/appointments", (db, now, req) => {
  const body = req.body ?? {};
  if (body.action === "rebook_book" || body.action === "rebook_refund") {
    const r = db.rebooks.find((x) => x.id === body.id);
    if (!r) return fail(404, { error: "Not found." });
    const res = body.action === "rebook_book" ? rebookChoose(db, now, r, body.startsAtISO, "clinic") : rebookRefund(db, now, r, "clinic");
    if (!res.ok) return fail(409, { error: res.error, code: res.code });
    return ok({ ok: true, message: res.rebook.status === "booked" ? `Booked for ${formatDublin(res.rebook.bookedStartsAtISO!)} on the payment they'd made.` : "Refunded in full. They've been emailed." });
  }
  const appt = getAppointment(db, String(body.appointmentId));
  if (!appt || appt.cancelled_at) return fail(409, { error: "That appointment is no longer in the diary (cancelled or deleted)." });
  const record = recordForAppointment(db, now, appt.id)!;
  if (body.action === "cancel") {
    if (paidOnline(record)) return fail(409, { error: "This one was paid through the Hub: use Cancel & refund, Cancel, keep payment or Late cancel.", code: "paid" });
    cancelAppointment(db, now, appt.id, `Cancelled by ${BY}`);
    if (db.bookings[appt.id]) Object.assign(db.bookings[appt.id], { status: "cancelled", cancelledBy: "clinic", cancelledAt: new Date(now).toISOString() });
    audit(db, now, { actor: "reception", by: BY, action: "appointments.cancel", appointmentId: appt.id });
    return ok({ ok: true, message: `Cancelled ${plain(record.appointmentTypeName)} on ${formatDublin(record.startsAtISO)}.` });
  }
  if (new Date(body.startsAtISO).getTime() < now) return fail(400, { error: "Pick a time in the future." });
  if (!db.bookings[appt.id]) db.bookings[appt.id] = record;
  const res = moveBooking(db, now, db.bookings[appt.id], body.startsAtISO, "clinic");
  if ("error" in res) return fail(res.status ?? 409, { error: res.error, code: "slot_taken" });
  return ok({ ok: true, message: `Moved to ${formatDublin(body.startsAtISO)}.${paidOnline(record) ? " The payment carries over." : ""}${record.patientEmail ? " They've been emailed." : ""}` });
});

// ---- Patient search (read only)

function visit(a: Appointment | undefined) {
  if (!a) return null;
  const t = typeById(a.appointment_type_id);
  return { startsAtISO: a.starts_at, practitionerId: a.practitioner_id, practitionerName: practitionerName(a.practitioner_id), appointmentTypeId: a.appointment_type_id, appointmentTypeName: t?.name ?? null };
}
function lastAndNext(db: Db, now: number, pid: string) {
  const nowIso = new Date(now).toISOString();
  const mine = liveAppointments(db).filter((a) => a.patient_id === pid).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { last: visit([...mine].reverse().find((a) => a.starts_at <= nowIso)), next: visit(mine.find((a) => a.starts_at > nowIso)) };
}

route("POST", "/api/admin/patient-lookup", (db, now, req) => {
  if (req.body?.action === "open") {
    const p = db.patients.find((x) => x.id === String(req.body.id));
    if (!p) return fail(404, { error: "Patient not found." });
    const { last, next } = lastAndNext(db, now, p.id);
    audit(db, now, { actor: "reception", by: BY, action: "patient.lookup.open" });
    return ok({
      patient: { firstName: p.first_name, lastName: p.last_name, email: p.email, phone: p.phone, dateOfBirth: p.date_of_birth ?? "", address: p.address_1 ?? "", county: "", eircode: "", gpName: "" },
      last, next, suggestedKind: suggestedKind(last?.startsAtISO, now),
    });
  }
  const q = parseLookupQuery(String(req.body?.q ?? ""));
  if (!q) return ok({ results: [], more: false });
  if (q.kind === "phone") return ok({ results: [], more: false, notSearchable: "The diary can't search by phone number. Search by surname or date of birth." });
  const found = db.patients.filter((p) =>
    q.kind === "dob" ? p.date_of_birth === q.dateOfBirth
      : q.kind === "email" ? p.email.toLowerCase() === q.email
      : p.last_name.toLowerCase().includes(q.last.toLowerCase()) && (!q.first || p.first_name.toLowerCase().includes(q.first.toLowerCase())),
  ).filter((p) => p.last_name !== "Patient" || p.first_name !== "Walk-in");
  audit(db, now, { actor: "reception", by: BY, action: "patient.lookup.search" });
  return ok({
    results: found.slice(0, 8).map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, dateOfBirth: p.date_of_birth, ...lastAndNext(db, now, p.id) })),
    more: found.length > 8,
  });
});

