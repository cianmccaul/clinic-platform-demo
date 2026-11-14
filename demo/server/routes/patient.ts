/** Patient-facing routes: booking, saved cards, manage a booking, rebook, waitlist. */
import { addDays, CLINIC_PHONE, dublinDay, isOutsideCancelWindow } from "@/core/policy";
import { isTherapistOnlyCategory } from "@/core/areas";
import { isPhoneOnly } from "@/core/phone-only";
import { missingDetails } from "@/core/patient-details";
import { verifiedPatientDetails } from "@/core/returning-checkout";
import { displayCode, voucherNetMinor } from "@/core/vouchers";
import { BUSINESS, PRACTITIONERS, practitionerById, practitionerName, priceMinor, TYPES, typeById } from "../clinic";
import { type Patient, audit, feeNetPaidMinor, netPaidMinor, nextNum, norm, paidOnline } from "../db";
import { availableTimes, findPatientsByEmail, isSlotAvailable, nextAvailable } from "../diary";
import { cancelBooking, chargeSaved, moveBooking, mail, rebookChoose, rebookRefund, startCheckout, type CheckoutBody } from "../flows";
import { fail, ok, route } from "../router";

const isStaff = (url: URL) => url.searchParams.get("staff") === "1";

route("GET", "/api/status", (db) => ok({ onlineBooking: db.flags.onlineBooking, message: db.flags.onlineBooking ? null : "Online booking is paused just now. Please call us and we'll book you in." }));

route("GET", "/api/businesses", () => ok({ businesses: [{ id: BUSINESS.id, name: BUSINESS.business_name }] }));

route("GET", "/api/appointment-types", (_db, _now, req) => {
  const staff = isStaff(req.url);
  const pid = req.url.searchParams.get("practitionerId");
  const types = TYPES.filter((t) => !pid || practitionerById(pid)?.offers.includes(t.id))
    .filter((t) => staff || t.show_in_online_bookings)
    .filter((t) => !isTherapistOnlyCategory(t.category))
    .map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description, durationMinutes: t.duration_in_minutes, fullPriceEUR: t.priceEUR }));
  return ok({ appointmentTypes: types });
});

route("GET", "/api/practitioners", (db, now, req) => {
  const typeId = req.url.searchParams.get("appointmentTypeId") ?? "";
  const staff = isStaff(req.url);
  const list = PRACTITIONERS.filter((p) => p.offers.includes(typeId))
    .filter((p) => staff || (p.show_in_online_bookings && !isPhoneOnly(p.id)))
    .map((p) => ({
      id: p.id, firstName: p.first_name, lastName: p.last_name, title: p.title, description: p.description, profilePictureUrl: null,
      ...(staff && isPhoneOnly(p.id) ? { notOnline: true } : {}),
      nextAvailableISO: nextAvailable(db, p.id, typeId, now),
    }))
    .sort((a, b) => (a.nextAvailableISO ?? "￿").localeCompare(b.nextAvailableISO ?? "￿"));
  return ok({ practitioners: list });
});

route("GET", "/api/available-times", (db, now, req) => {
  const q = req.url.searchParams;
  const times = availableTimes(db, q.get("practitionerId") ?? "", q.get("appointmentTypeId") ?? "", q.get("from") ?? dublinDay(new Date(now).toISOString()), q.get("to") ?? dublinDay(new Date(now).toISOString()), now, {
    excludeAppointmentId: q.get("excludeAppointmentId") ?? undefined,
  });
  return ok({ availableTimes: times.map((t) => ({ appointment_start: t })) });
});

/** A patient as the diary system (Cliniko) returns them, which is what the shared rules in core/ read. */
export const asRecord = (p: Patient) => ({ ...p, patient_phone_numbers: p.phone ? [{ phone_type: "Mobile", number: p.phone }] : [], notes: p.gp_name ? `GP: ${p.gp_name}` : "" });

route("POST", "/api/checkout", (db, now, req) => {
  const b = req.body as CheckoutBody & { policyAccepted?: boolean; token?: string; details?: Record<string, string> };
  if (isPhoneOnly(b.practitionerId)) return fail(400, { error: `This therapist is booked by phone only. Please call us on ${CLINIC_PHONE}.`, code: "phone_only" });
  // A returning patient who entered the emailed code sends the code session and only what their record
  // lacks, instead of typing everything again (core/returning-checkout.ts).
  let verifiedPatientId: string | undefined;
  if (typeof b.token === "string" && !b.patient) {
    const id = tokenPatients(db, now, b.token, "returning")[0];
    const record = id ? db.patients.find((p) => p.id === id) : undefined;
    if (!record) return fail(401, { error: "Your code has expired. Ask for a new one, or enter your details instead.", code: "session_expired" });
    const onFile = verifiedPatientDetails(asRecord(record), b.details ?? {});
    if (!onFile.usable) return fail(401, { error: "Please enter your details to book.", code: "session_expired" });
    if (onFile.missing.length) return fail(400, { error: "Please fill in the details we're missing.", code: "missing_details", missing: onFile.missing });
    verifiedPatientId = record.id;
    b.patient = { ...onFile.patient, phone: onFile.patient.phone ?? "", dateOfBirth: onFile.patient.dateOfBirth ?? record.date_of_birth ?? "" };
  }
  const r = startCheckout(db, now, b, { verifiedPatientId });
  if (r.booked) return ok({ booked: true, appointmentId: r.booked.appointmentId, url: "/booking/confirmed?booked=1&voucher=1" });
  if (!r.session) return fail(r.status ?? 400, { error: r.error, code: r.code });
  return ok({ url: `/demo-checkout?session=${encodeURIComponent(r.session.id)}` });
});

route("GET", "/api/booking-status", (db, _now, req) => {
  const id = req.url.searchParams.get("session_id") ?? "";
  const outcome = db.outcomes[id];
  if (outcome) {
    if (outcome.state === "booked") return ok({ state: "booked", startsAtISO: outcome.startsAtISO, appointmentTypeName: outcome.appointmentTypeName ?? null, reference: outcome.appointmentId });
    return ok(outcome);
  }
  const s = db.sessions.find((x) => x.id === id);
  if (!s) return fail(404, { state: "not_found" });
  return ok({ state: s.payment_status === "paid" ? "processing" : "unpaid" });
});

// ---- one-time codes (returning patients and manage a booking)

function sendCode(db: import("../db").Db, now: number, purpose: "manage" | "returning", email: string) {
  const e = norm(email);
  db.codes = db.codes.filter((c) => !(c.email === e && c.purpose === purpose));
  if (!findPatientsByEmail(db, e).length) {
    if (purpose === "manage") mail(db, now, e, "manage_none", { clinic_phone: CLINIC_PHONE });
    return;
  }
  const code = String(100000 + Math.floor(Math.random() * 900000));
  db.codes.push({ purpose, email: e, code, expiresAt: new Date(now + 10 * 60_000).toISOString() });
  mail(db, now, e, "code", { code, minutes: "10", purpose: purpose === "manage" ? "manage your booking" : "book with the details we have on file" });
}

function useCode(db: import("../db").Db, now: number, purpose: "manage" | "returning", email: string, code: string) {
  const e = norm(email);
  const c = db.codes.find((x) => x.email === e && x.purpose === purpose);
  if (!c || c.code !== String(code).trim() || c.expiresAt < new Date(now).toISOString()) return null;
  db.codes = db.codes.filter((x) => x !== c);
  const token = `tok${nextNum(db)}${Math.random().toString(36).slice(2, 10)}`;
  db.tokens.push({ token, purpose, patientIds: findPatientsByEmail(db, e).map((p) => p.id), expiresAt: new Date(now + 30 * 60_000).toISOString() });
  return token;
}

const tokenPatients = (db: import("../db").Db, now: number, token: string, purpose: "manage" | "returning") =>
  db.tokens.find((t) => t.token === token && t.purpose === purpose && t.expiresAt > new Date(now).toISOString())?.patientIds ?? [];

const validEmail = (e: unknown) => typeof e === "string" && /^\S+@\S+\.\S+$/.test(e.trim());

route("POST", "/api/returning-patient/start", (db, now, req) => {
  if (!validEmail(req.body?.email)) return fail(400, { error: "Please enter a valid email address." });
  sendCode(db, now, "returning", req.body.email);
  return ok({ ok: true });
});

route("POST", "/api/returning-patient/verify", (db, now, req) => {
  const token = useCode(db, now, "returning", req.body?.email ?? "", req.body?.code ?? "");
  if (!token) return fail(400, { error: "That code is incorrect or has expired." });
  const ids = tokenPatients(db, now, token, "returning");
  if (ids.length > 1) return fail(404, { error: "More than one patient uses this email, so please fill in the details below for the person you're booking for.", noSavedCard: true });
  const record = db.patients.find((p) => p.id === ids[0]);
  const noRecord = fail(404, { error: "We couldn't find your details under this email, so please fill them in below.", noSavedCard: true });
  if (!record) return noRecord;
  const card = db.savedCards[record.id];
  // With a saved card they skip the payment page too.
  if (card) return ok({ token, card: { brand: card.brand, last4: card.last4 }, missing: missingDetails(asRecord(record)), firstName: record.first_name, lastName: record.last_name });
  // No saved card: their details still come from their record, and they pay by card as usual.
  const onFile = verifiedPatientDetails(asRecord(record), {});
  if (!onFile.usable) return noRecord;
  return ok({ token, card: null, missing: onFile.missing, firstName: onFile.patient.firstName, lastName: onFile.patient.lastName });
});

route("POST", "/api/charge-returning-patient", (db, now, req) => {
  const ids = tokenPatients(db, now, req.body?.token ?? "", "returning");
  if (!ids.length) return fail(401, { error: "session_expired" });
  if (isPhoneOnly(req.body.practitionerId)) return fail(400, { error: "phone_only", message: `This therapist is booked by phone only. Please call us on ${CLINIC_PHONE}.` });
  const r = chargeSaved(db, now, ids[0], req.body as CheckoutBody);
  return { status: r.status, json: r.json };
});

route("POST", "/api/manage/start", (db, now, req) => {
  if (!validEmail(req.body?.email)) return fail(400, { error: "Please enter a valid email address." });
  sendCode(db, now, "manage", req.body.email);
  return ok({ ok: true });
});

route("POST", "/api/manage/verify", (db, now, req) => {
  const token = useCode(db, now, "manage", req.body?.email ?? "", req.body?.code ?? "");
  return token ? ok({ token }) : fail(400, { error: "That code is incorrect or has expired." });
});

route("POST", "/api/manage/bookings", (db, now, req) => {
  const ids = tokenPatients(db, now, req.body?.token ?? "", "manage");
  if (!ids.length) return fail(401, { error: "session_expired" });
  const family = ids.length > 1;
  const nowIso = new Date(now).toISOString();
  const upcoming = db.appointments.filter((a) => ids.includes(a.patient_id) && !a.cancelled_at && a.starts_at > nowIso).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const bookings = upcoming.map((a) => {
    const rec = db.bookings[a.id];
    const t = typeById(a.appointment_type_id)!;
    const paid = rec ? paidOnline(rec) : false;
    const free = isOutsideCancelWindow(a.starts_at, now);
    return {
      appointmentId: a.id,
      appointmentTypeName: t.name,
      patientFirstName: family ? db.patients.find((p) => p.id === a.patient_id)?.first_name ?? null : null,
      appointmentTypeId: t.id,
      practitionerId: a.practitioner_id,
      practitionerName: practitionerName(a.practitioner_id),
      businessId: BUSINESS.id,
      startsAtISO: a.starts_at,
      paidOnline: paid,
      paidMinor: rec ? netPaidMinor(rec) : 0,
      paidInFull: !!rec?.payments.some((p) => p.kind === "full"),
      fullPriceMinor: priceMinor(t.id),
      freeCancellation: free,
      canCancelOnline: free || paid,
      canReschedule: free,
    };
  });
  return ok({ bookings, payments: pastPayments(db, ids) });
});

/**
 * "Past payments" on Manage a booking: every payment and refund against this
 * patient's bookings, newest first, so they can check what they were charged
 * without ringing reception.
 */
function pastPayments(db: import("../db").Db, ids: string[]) {
  const cardText = (id: string) => {
    const c = db.payments.find((p) => p.id === id)?.card;
    return c ? `${c.brand[0].toUpperCase()}${c.brand.slice(1)} ending ${c.last4}` : null;
  };
  const KIND: Record<string, string> = { full: "Appointment fee", deposit: "Deposit", balance: "Balance", extra: "Extra treatment", late_cancel: "Late cancellation fee", no_show: "Missed appointment fee" };
  const rows = Object.values(db.bookings)
    .filter((b) => ids.includes(b.clinikoPatientId))
    .flatMap((b) => {
      const base = { appointmentId: b.appointmentId, treatment: (b.appointmentTypeName ?? "Appointment").replace(/ - .*$/, ""), practitionerName: practitionerName(b.practitionerId), appointmentAtISO: b.startsAtISO, cancelled: b.status === "cancelled" };
      const cards = b.payments.map((p) => ({
        ...base, id: p.paymentIntentId, paidAtISO: p.at, what: p.kind === "extra" && p.label ? `Extra treatment: ${p.label}` : KIND[p.kind] ?? "Payment",
        method: cardText(p.paymentIntentId) ?? "Card", amountMinor: p.amountMinor, refundedMinor: p.refundedMinor,
      }));
      const voucher = b.voucher
        ? [{ ...base, id: `voucher-${b.appointmentId}`, paidAtISO: b.voucher.at, what: "Appointment fee", method: `Gift voucher ${displayCode(b.voucher.code)}`, amountMinor: b.voucher.amountMinor, refundedMinor: b.voucher.amountMinor - voucherNetMinor(b.voucher) }]
        : [];
      return [...cards, ...voucher];
    })
    .sort((a, b) => b.paidAtISO.localeCompare(a.paidAtISO));
  return rows.slice(0, 30);
}

function patientRecord(db: import("../db").Db, now: number, token: string, appointmentId: string) {
  const ids = tokenPatients(db, now, token, "manage");
  if (!ids.length) return { error: fail(401, { error: "session_expired" }) };
  const a = db.appointments.find((x) => x.id === appointmentId && ids.includes(x.patient_id));
  if (!a) return { error: fail(404, { error: "Booking not found." }) };
  const p = db.patients.find((x) => x.id === a.patient_id)!;
  if (!db.bookings[a.id]) {
    const t = typeById(a.appointment_type_id)!;
    db.bookings[a.id] = {
      appointmentId: a.id, clinikoPatientId: p.id, patientName: `${p.first_name} ${p.last_name}`, patientEmail: p.email, businessId: BUSINESS.id,
      practitionerId: a.practitioner_id, appointmentTypeId: t.id, appointmentTypeName: t.name, startsAtISO: a.starts_at, durationMinutes: t.duration_in_minutes,
      status: "booked", payments: [], createdAt: new Date(now).toISOString(), source: "cliniko",
    };
  }
  return { record: db.bookings[a.id] };
}

route("POST", "/api/manage/cancel", (db, now, req) => {
  const r = patientRecord(db, now, req.body?.token ?? "", String(req.body?.appointmentId ?? ""));
  if (r.error) return r.error;
  const b = r.record!;
  if (b.status === "cancelled") return fail(409, { error: "This booking has already been cancelled." });
  if (new Date(b.startsAtISO).getTime() <= now) return fail(409, { error: "This appointment has already started." });
  if (!paidOnline(b) && !isOutsideCancelWindow(b.startsAtISO, now)) return fail(409, { error: `This appointment is less than 24 hours away — please call us on ${CLINIC_PHONE} to cancel.` });
  return ok({ cancelled: true, ...cancelBooking(db, now, b, "patient") });
});

route("POST", "/api/manage/reschedule", (db, now, req) => {
  const r = patientRecord(db, now, req.body?.token ?? "", String(req.body?.appointmentId ?? ""));
  if (r.error) return r.error;
  const b = r.record!;
  if (!isOutsideCancelWindow(b.startsAtISO, now)) return fail(409, { error: `Bookings within 24 hours can't be moved online. Please call us on ${CLINIC_PHONE}.` });
  const res = moveBooking(db, now, b, req.body.newStartsAtISO, "patient");
  if ("error" in res) return fail(res.status ?? 409, { error: res.error });
  return ok({ rescheduled: true, startsAtISO: res.startsAtISO });
});

route("GET", "/api/rebook/:token", (db, _now, req) => {
  const r = db.rebooks.find((x) => x.token === req.params.token);
  if (!r) return fail(404, { error: "not_found" });
  return ok({
    status: r.status, firstName: r.patient.firstName, appointmentTypeName: r.appointmentTypeName, practitionerName: r.practitionerName, amountMinor: r.amountMinor,
    originalStartsAtISO: r.originalStartsAtISO, refundBy: r.refundBy, bookedStartsAtISO: r.bookedStartsAtISO ?? null, businessId: r.businessId,
    practitionerId: r.practitionerId, appointmentTypeId: r.appointmentTypeId,
  });
});

route("POST", "/api/rebook/:token", (db, now, req) => {
  const r = db.rebooks.find((x) => x.token === req.params.token);
  if (!r) return fail(404, { error: "not_found" });
  const res = req.body?.action === "refund" ? rebookRefund(db, now, r, "patient") : rebookChoose(db, now, r, req.body?.startsAtISO, "patient");
  if (!res.ok) return fail(409, { error: res.error, code: res.code });
  return ok({ ok: true, status: res.rebook.status, bookedStartsAtISO: res.rebook.bookedStartsAtISO ?? null });
});

// Used by the reception booking flow before reserving a time.
route("POST", "/api/admin/slot-check", (db, now, req) => {
  const b = req.body ?? {};
  return ok({ available: isSlotAvailable(db, String(b.practitionerId), String(b.appointmentTypeId), b.startsAtISO, now) });
});

export { feeNetPaidMinor, priceMinor };
