/**
 * The booking flows, following production's design:
 *
 * Online booking (pay, then book):
 *   1. /api/checkout re-checks the slot, holds it for 30 minutes and opens checkout.
 *   2. The patient pays on the therapist's own account.
 *   3. The "checkout completed" webhook: ignore a repeat; re-check the slot;
 *      if it has gone, KEEP the payment and email a link to pick another time
 *      ("rebook", auto-refunded after 7 days); otherwise find or create the
 *      patient, look before creating the appointment, save the booking record.
 *   4. If the diary is down the webhook is retried; if it never recovers the
 *      patient is refunded in full and the clinic alerted.
 */
import type { BookingRecord } from "@/lib/bookings";
import { fillTemplate, type EmailTemplateId } from "@/core/email-templates";
import { CLINIC_PHONE, EXTRAS_SENTENCE, euro, isOutsideCancelWindow } from "@/core/policy";
import { whenLong, whenShort } from "@/core/format";
import { REBOOK_DAYS } from "@/core/rebook";
import { BUSINESS, practitionerById, practitionerName, priceMinor, typeById } from "./clinic";
import { type CheckoutSession, type Db, type Rebook, audit, feeNetPaidMinor, netPaidMinor, nextNum, paidOnline, randomToken, sendEmail, stripeId } from "./db";
import { appendNote, cancelAppointment, createAppointment, findByBookingKey, findOrCreatePatient, getAppointment, hold, isSlotAvailable, moveAppointment, plusMinutes, releaseHold } from "./diary";
import { charge, entryFor, refundUpTo } from "./stripe";

export const SLOT_TAKEN_MESSAGE = "Sorry, someone has just booked that time. Please choose another.";
const HOLD_MINUTES = 30;
const plainType = (name?: string) => (name ?? "Appointment").replace(/^\d+\.\s*/, "");

/** Send one of production's email templates (core/email-templates.ts), filled in. */
export function mail(db: Db, now: number, to: string, id: EmailTemplateId, values: Record<string, string | null | undefined>, link?: string, label?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = fillTemplate(id, values as any);
  sendEmail(db, now, to, m.subject, link ? `${m.text}\n\n[${label || m.button || "Open"}](${link})` : m.text);
}

export function factsFor(b: Pick<BookingRecord, "patientName" | "appointmentTypeName" | "practitionerId" | "startsAtISO">) {
  return {
    first_name: (b.patientName ?? "").split(" ")[0] || "there",
    treatment: plainType(b.appointmentTypeName),
    practitioner: practitionerName(b.practitionerId),
    when: whenLong(b.startsAtISO),
    when_short: whenShort(b.startsAtISO),
    clinic_phone: CLINIC_PHONE,
    extras_sentence: EXTRAS_SENTENCE,
  };
}

export function newRecord(appt: { id: string; patient_id: string; practitioner_id: string; appointment_type_id: string; starts_at: string }, patient: { first_name: string; last_name: string; email: string }, now: number, source: "online" | "cliniko" = "online"): BookingRecord {
  const t = typeById(appt.appointment_type_id)!;
  return {
    appointmentId: appt.id,
    clinikoPatientId: appt.patient_id,
    patientName: `${patient.first_name} ${patient.last_name}`,
    patientEmail: patient.email,
    businessId: BUSINESS.id,
    practitionerId: appt.practitioner_id,
    appointmentTypeId: appt.appointment_type_id,
    appointmentTypeName: t.name,
    startsAtISO: appt.starts_at,
    durationMinutes: t.duration_in_minutes,
    status: "booked",
    payments: [],
    createdAt: new Date(now).toISOString(),
    source,
  };
}

// ---------------------------------------------------------------- checkout

export type CheckoutBody = {
  practitionerId: string;
  appointmentTypeId: string;
  businessId?: string;
  startsAtISO: string;
  visit?: string;
  patient: { firstName: string; lastName: string; email: string; phone: string; dateOfBirth: string };
};

export function startCheckout(db: Db, now: number, body: CheckoutBody, extra: { payLinkId?: string } = {}): { session?: CheckoutSession; error?: string; code?: string; status?: number } {
  if (!db.flags.onlineBooking && !extra.payLinkId) return { error: "Online booking is paused just now. Please call us and we'll book you in.", code: "paused", status: 503 };
  const t = typeById(body.appointmentTypeId);
  const p = practitionerById(body.practitionerId);
  if (!t || !p || !p.offers.includes(t.id)) return { error: "Invalid request.", status: 400 };
  const owner = `checkout:${body.patient.email.toLowerCase()}`;
  if (!isSlotAvailable(db, p.id, t.id, body.startsAtISO, now, { holdOwner: owner })) return { error: SLOT_TAKEN_MESSAGE, code: "slot_taken", status: 409 };
  hold(db, now, { owner, practitionerId: p.id, startsAt: body.startsAtISO, endsAt: plusMinutes(body.startsAtISO, t.duration_in_minutes) }, HOLD_MINUTES);
  const session: CheckoutSession = {
    id: stripeId(db, "cs_test").replace(/_d/, "_"),
    status: "open",
    payment_status: "unpaid",
    account: p.account,
    amount: priceMinor(t.id),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + HOLD_MINUTES * 60_000).toISOString(),
    meta: { practitionerId: p.id, appointmentTypeId: t.id, businessId: BUSINESS.id, startsAtISO: body.startsAtISO, patient: body.patient, visit: body.visit, payLinkId: extra.payLinkId },
  };
  db.sessions.push(session);
  audit(db, now, { actor: "patient", action: "checkout.started", amountMinor: session.amount });
  return { session };
}

export type Simulate = "none" | "slot_taken" | "diary_down";

/**
 * The patient pays on the (pretend) Stripe page, then the webhook runs.
 * The demo's "simulate a problem" choices show the two failure paths.
 */
export function payCheckout(db: Db, now: number, sessionId: string, simulate: Simulate) {
  const s = db.sessions.find((x) => x.id === sessionId);
  if (!s) return { error: "This payment page has expired." };
  if (s.status !== "open") return { error: "This has already been paid." };
  if (new Date(s.expiresAt).getTime() < now) {
    s.status = "expired";
    return { error: "This payment page has expired. Please go back and choose your time again." };
  }
  const pi = charge(db, now, { practitionerId: s.meta.practitionerId, amountMinor: s.amount, description: `${plainType(typeById(s.meta.appointmentTypeId)?.name)} ${whenShort(s.meta.startsAtISO)}` });
  s.status = "complete";
  s.payment_status = "paid";
  s.paymentIntentId = pi.id;

  if (s.meta.visitPaymentId) return visitPaid(db, now, s);

  if (simulate === "slot_taken") {
    // Reception books the same time by phone while the patient is on the payment page.
    const other = findOrCreatePatient(db, now, { firstName: "Walk-in", lastName: "Patient", email: "walk-in@example.com" });
    createAppointment(db, now, { patientId: other.id, practitionerId: s.meta.practitionerId, typeId: s.meta.appointmentTypeId, startsAt: s.meta.startsAtISO, note: "Booked by phone" });
    releaseHold(db, `checkout:${s.meta.patient.email.toLowerCase()}`);
  }

  const event = { id: `evt_${s.id}`, sessionId: s.id };
  if (simulate === "diary_down") {
    // Stripe retries a failing webhook for about two hours; the patient sees "taking a little longer" meanwhile.
    for (let attempt = 1; attempt <= 3; attempt++) audit(db, now, { actor: "system", action: "webhook.retry", note: `Diary didn't answer (attempt ${attempt})` });
    return bookingFailed(db, now, s);
  }
  return handleCheckoutCompleted(db, now, event);
}

/** The webhook handler. Safe to run twice: the second run changes nothing. */
export function handleCheckoutCompleted(db: Db, now: number, event: { id: string; sessionId: string }) {
  if (db.processedEvents.includes(event.id)) return { outcome: db.outcomes[event.sessionId], duplicate: true };
  const s = db.sessions.find((x) => x.id === event.sessionId)!;
  const m = s.meta;
  const t = typeById(m.appointmentTypeId)!;
  const owner = `checkout:${m.patient.email.toLowerCase()}`;
  const pi = db.payments.find((x) => x.id === s.paymentIntentId)!;

  // A pay link's own 2-hour hold on this time belongs to this payment.
  if (m.payLinkId) releaseHold(db, `paylink:${m.payLinkId}`);
  const already = findByBookingKey(db, s.id);
  const slotFree = !!already || isSlotAvailable(db, m.practitionerId, t.id, m.startsAtISO, now, { holdOwner: owner });

  if (!slotFree) {
    // Keep the payment and let them pick another time (production since 3 Nov 2026).
    const patient = findOrCreatePatient(db, now, m.patient);
    const token = randomToken();
    const rebook: Rebook = {
      id: `rb${nextNum(db)}`, token, status: "open", createdAt: new Date(now).toISOString(),
      refundBy: new Date(now + REBOOK_DAYS * 86_400_000).toISOString(), sessionId: s.id,
      patient: { firstName: m.patient.firstName, lastName: m.patient.lastName, email: m.patient.email }, clinikoPatientId: patient.id,
      practitionerId: m.practitionerId, practitionerName: practitionerName(m.practitionerId), appointmentTypeId: t.id, appointmentTypeName: t.name,
      businessId: BUSINESS.id, originalStartsAtISO: m.startsAtISO, amountMinor: s.amount, paymentIntentId: pi.id,
    };
    db.rebooks.push(rebook);
    db.outcomes[s.id] = { state: "rebook" };
    closePayLink(db, now, m.payLinkId, "rebook");
    db.processedEvents.push(event.id);
    releaseHold(db, owner);
    sendEmail(db, now, m.patient.email, `Please pick another time: you've already paid ${euro(s.amount)}`,
      `Hi ${m.patient.firstName},\n\nSorry: the ${whenLong(m.startsAtISO)} time with ${rebook.practitionerName} was taken just as you paid. You don't need to pay again. Pick another time with ${rebook.practitionerName} for your ${plainType(t.name)} using the link below, or ask for your money back.\n\nIf you don't choose a time by ${whenLong(rebook.refundBy)}, we'll refund you in full automatically.\n\n[Pick another time](/rebook/${token})`);
    audit(db, now, { actor: "system", action: "rebook.offered", amountMinor: s.amount, note: "Slot taken while paying: payment kept" });
    return { outcome: db.outcomes[s.id] };
  }

  const patient = findOrCreatePatient(db, now, m.patient);
  const appt = already ?? createAppointment(db, now, { patientId: patient.id, practitionerId: m.practitionerId, typeId: t.id, startsAt: m.startsAtISO, bookingKey: s.id, note: m.visit ? `Patient type: ${m.visit}` : undefined });
  const record = db.bookings[appt.id] ?? newRecord(appt, patient, now);
  if (!record.payments.some((p) => p.paymentIntentId === pi.id)) record.payments.push(entryFor(pi, "full"));
  db.bookings[appt.id] = record;
  pi.patientId = patient.id;
  db.savedCards[patient.id] = { ...pi.card, account: pi.account };
  db.outcomes[s.id] = { state: "booked", appointmentId: appt.id, startsAtISO: appt.starts_at, appointmentTypeName: plainType(t.name) };
  db.processedEvents.push(event.id);
  releaseHold(db, owner);
  closePayLink(db, now, m.payLinkId, "paid", appt.id);
  sendEmail(db, now, m.patient.email, `Booked: ${plainType(t.name)}, ${whenShort(appt.starts_at)}`,
    `Hi ${m.patient.firstName},\n\nYou're booked in with ${practitionerName(m.practitionerId)} on ${whenLong(appt.starts_at)}. You've paid ${euro(s.amount)}.\n\nFree to cancel or change until 24 hours before. After that, or if you miss the appointment, the full appointment fee is charged.\n\n[Manage your booking](/manage)`);
  audit(db, now, { actor: "system", action: "booking.created", appointmentId: appt.id, amountMinor: s.amount });
  return { outcome: db.outcomes[s.id] };
}

/** A pay link (phone booking or waitlist offer) has been paid for or ended in a rebook. */
function closePayLink(db: Db, now: number, id: string | undefined, status: "paid" | "rebook", appointmentId?: string) {
  const link = id ? db.payLinks.find((l) => l.id === id) : undefined;
  if (!link) return;
  Object.assign(link, { status, ...(appointmentId ? { appointmentId } : {}) });
  db.holds = db.holds.filter((h) => h.owner !== `paylink:${link.id}`);
  const entry = link.waitlistEntryId ? db.waitlist.find((e) => e.id === link.waitlistEntryId) : undefined;
  if (entry && status === "paid") {
    Object.assign(entry, { status: "filled", closedAt: new Date(now).toISOString() });
    delete entry.offer;
    audit(db, now, { actor: "patient", action: "waitlist.filled", appointmentId });
  }
}

/** Paid for an appointment they've already had: recorded against that appointment. */
function visitPaid(db: Db, now: number, s: CheckoutSession) {
  const v = db.visitPayments.find((x) => x.id === s.meta.visitPaymentId)!;
  const pi = db.payments.find((x) => x.id === s.paymentIntentId)!;
  const rec = recordForAppointment(db, now, v.appointmentId)!;
  pi.patientId = rec.clinikoPatientId;
  rec.payments.push(entryFor(pi, feeNetPaidMinor(rec) > 0 ? "balance" : "full"));
  db.bookings[v.appointmentId] = rec;
  v.status = "paid";
  db.processedEvents.push(`evt_${s.id}`);
  appendNote(db, v.appointmentId, `Paid ${euro(s.amount)} online (payment link from ${v.by})`);
  sendEmail(db, now, v.email, `Payment received: ${euro(s.amount)}`, `Hi ${v.firstName},\n\nThanks: we've received ${euro(s.amount)} for your ${v.appointmentTypeName} on ${whenLong(v.startsAtISO)}. Your receipt and invoice follow by email.`);
  audit(db, now, { actor: "patient", action: "visit_payment.paid", appointmentId: v.appointmentId, amountMinor: s.amount });
  return { visit: true as const };
}

/** The diary never came back: refund in full, tell the patient, alert the clinic. */
function bookingFailed(db: Db, now: number, s: CheckoutSession) {
  const pi = db.payments.find((x) => x.id === s.paymentIntentId)!;
  const amount = pi.amount - pi.amount_refunded;
  pi.amount_refunded = pi.amount;
  db.refunds.push({ id: stripeId(db, "re"), payment_intent: pi.id, amount, reason: "Booking couldn't be made", by: "system", created: new Date(now).toISOString() });
  db.outcomes[s.id] = { state: "refunded", reason: "booking_failed" };
  db.processedEvents.push(`evt_${s.id}`);
  releaseHold(db, `checkout:${s.meta.patient.email.toLowerCase()}`);
  mail(db, now, s.meta.patient.email, "not_booked_failed", {
    first_name: s.meta.patient.firstName, treatment: plainType(typeById(s.meta.appointmentTypeId)?.name), practitioner: practitionerName(s.meta.practitionerId),
    when: whenLong(s.meta.startsAtISO), when_short: whenShort(s.meta.startsAtISO), amount: euro(amount), clinic_phone: CLINIC_PHONE,
  });
  audit(db, now, { actor: "system", action: "refund.booking_failed", amountMinor: amount, note: "Diary unavailable after retries. Clinic alerted." });
  return { outcome: db.outcomes[s.id] };
}

// ---------------------------------------------------------------- returning patients (saved card)

export function chargeSaved(db: Db, now: number, patientId: string, body: CheckoutBody) {
  const t = typeById(body.appointmentTypeId)!;
  const p = practitionerById(body.practitionerId)!;
  if (!db.flags.onlineBooking) return { status: 503, json: { error: "paused", message: "Online booking is paused just now. Please call us and we'll book you in." } };
  if (!isSlotAvailable(db, p.id, t.id, body.startsAtISO, now)) return { status: 409, json: { error: "slot_taken", message: SLOT_TAKEN_MESSAGE } };
  const card = db.savedCards[patientId];
  if (!card) return { status: 402, json: { error: "card_unavailable", message: "Please enter your card details for this appointment." } };
  const patient = db.patients.find((x) => x.id === patientId)!;
  const pi = charge(db, now, { practitionerId: p.id, amountMinor: priceMinor(t.id), description: `${plainType(t.name)} ${whenShort(body.startsAtISO)}`, patientId, card });
  const appt = createAppointment(db, now, { patientId, practitionerId: p.id, typeId: t.id, startsAt: body.startsAtISO, note: body.visit ? `Patient type: ${body.visit}` : undefined });
  const record = newRecord(appt, patient, now);
  record.payments.push(entryFor(pi, "full"));
  db.bookings[appt.id] = record;
  sendEmail(db, now, patient.email, `Booked: ${plainType(t.name)}, ${whenShort(appt.starts_at)}`, `Hi ${patient.first_name},\n\nYou're booked in with ${practitionerName(p.id)} on ${whenLong(appt.starts_at)}, paid with your saved card ending ${card.last4}.`);
  audit(db, now, { actor: "patient", action: "booking.saved_card", appointmentId: appt.id, amountMinor: pi.amount });
  return { status: 200, json: { paymentIntentId: pi.id, status: "succeeded", voucherMinor: 0 } };
}

// ---------------------------------------------------------------- cancel and move

export type CancelMode = "refund" | "keep" | "charge_full";

/** Cancel under the policy (production's lib/manage.ts cancelBooking). */
export function cancelBooking(db: Db, now: number, b: BookingRecord, by: "patient" | "clinic", clinicMode?: CancelMode, staffName = "Reception") {
  const late = !isOutsideCancelWindow(b.startsAtISO, now);
  const mode: CancelMode = by === "patient" ? (late ? "charge_full" : "refund") : clinicMode ?? "refund";
  const held = netPaidMinor(b);
  let refunded = 0;
  let lateFee = 0;
  if (mode === "refund" && held > 0) refunded = refundUpTo(db, now, b, held, by === "patient" ? "Cancelled in good time" : "Cancelled by the clinic", by === "patient" ? "patient" : staffName);
  if (mode === "charge_full") {
    const owed = Math.max(0, priceMinor(b.appointmentTypeId) - feeNetPaidMinor(b));
    const card = db.savedCards[b.clinikoPatientId];
    if (owed > 0 && card) {
      const pi = charge(db, now, { practitionerId: b.practitionerId, amountMinor: owed, description: `Late cancellation ${whenShort(b.startsAtISO)}`, patientId: b.clinikoPatientId, card });
      b.payments.push(entryFor(pi, "late_cancel"));
      lateFee = owed;
    }
  }
  b.status = "cancelled";
  b.cancelledAt = new Date(now).toISOString();
  b.cancelledBy = by;
  b.lateCancellation = late && mode !== "refund";
  cancelAppointment(db, now, b.appointmentId, `Cancelled by ${by === "patient" ? "the patient online" : staffName}${refunded ? `, refunded ${euro(refunded)}` : ""}`);
  if (b.patientEmail) {
    if (refunded) mail(db, now, b.patientEmail, "cancel_refund", { ...factsFor(b), amount: euro(refunded) });
    else mail(db, now, b.patientEmail, "cancel_fee", { ...factsFor(b), amount: euro(held + lateFee) });
  }
  audit(db, now, { actor: by === "patient" ? "patient" : "reception", by: by === "clinic" ? staffName : undefined, action: late ? "cancel.late" : "cancel", appointmentId: b.appointmentId, amountMinor: refunded || lateFee || undefined });
  return { late: mode === "charge_full", refundedMinor: refunded, keptMinor: held - refunded, lateFeeMinor: lateFee, lateFeeFailed: false, voucherReturnedMinor: 0 };
}

export function moveBooking(db: Db, now: number, b: BookingRecord, newStartsAtISO: string, by: "patient" | "clinic") {
  if (!isSlotAvailable(db, b.practitionerId, b.appointmentTypeId, newStartsAtISO, now, { excludeAppointmentId: b.appointmentId })) return { error: SLOT_TAKEN_MESSAGE, status: 409 };
  const from = b.startsAtISO;
  moveAppointment(db, b.appointmentId, newStartsAtISO);
  b.startsAtISO = newStartsAtISO;
  appendNote(db, b.appointmentId, `Moved from ${whenShort(from)} by ${by === "patient" ? "the patient online" : "reception"}`);
  if (b.patientEmail) mail(db, now, b.patientEmail, "moved", { ...factsFor(b), old_when: whenLong(from) });
  audit(db, now, { actor: by === "patient" ? "patient" : "reception", action: "moved", appointmentId: b.appointmentId });
  return { ok: true as const, startsAtISO: newStartsAtISO, from };
}

/** A booking record for any diary appointment (phone bookings have no payments yet). */
export function recordForAppointment(db: Db, now: number, appointmentId: string): BookingRecord | null {
  if (db.bookings[appointmentId]) return db.bookings[appointmentId];
  const a = getAppointment(db, appointmentId);
  const p = a && db.patients.find((x) => x.id === a.patient_id);
  if (!a || !p) return null;
  return newRecord(a, p, now, "cliniko");
}

// ---------------------------------------------------------------- rebook ("you've already paid: pick another time")

export function rebookChoose(db: Db, now: number, r: Rebook, startsAtISO: string, by: "patient" | "clinic") {
  if (r.status !== "open") return { ok: false as const, error: "This has already been sorted.", code: "closed" };
  if (!isSlotAvailable(db, r.practitionerId, r.appointmentTypeId, startsAtISO, now)) return { ok: false as const, error: SLOT_TAKEN_MESSAGE, code: "slot_taken" };
  const patient = db.patients.find((x) => x.id === r.clinikoPatientId)!;
  const appt = createAppointment(db, now, { patientId: patient.id, practitionerId: r.practitionerId, typeId: r.appointmentTypeId, startsAt: startsAtISO, note: "Rebooked: paid earlier for a time that was taken" });
  const record = newRecord(appt, patient, now);
  const pi = db.payments.find((x) => x.id === r.paymentIntentId)!;
  record.payments.push(entryFor(pi, "full"));
  db.bookings[appt.id] = record;
  db.savedCards[patient.id] = { ...pi.card, account: pi.account };
  Object.assign(r, { status: "booked", bookedStartsAtISO: startsAtISO, bookedAppointmentId: appt.id });
  sendEmail(db, now, r.patient.email, `Booked: ${plainType(r.appointmentTypeName)}, ${whenShort(startsAtISO)}`, `Hi ${r.patient.firstName},\n\nYou're booked in with ${r.practitionerName} on ${whenLong(startsAtISO)}, using the ${euro(r.amountMinor)} you'd already paid.`);
  audit(db, now, { actor: by === "patient" ? "patient" : "reception", action: "rebook.booked", appointmentId: appt.id });
  return { ok: true as const, rebook: r };
}

export function rebookRefund(db: Db, now: number, r: Rebook, by: "patient" | "clinic" | "system") {
  if (r.status !== "open") return { ok: false as const, error: "This has already been sorted.", code: "closed" };
  const pi = db.payments.find((x) => x.id === r.paymentIntentId)!;
  const amount = pi.amount - pi.amount_refunded;
  pi.amount_refunded = pi.amount;
  db.refunds.push({ id: stripeId(db, "re"), payment_intent: pi.id, amount, reason: by === "system" ? `Not rebooked within ${REBOOK_DAYS} days` : "Asked for a refund instead of a new time", by, created: new Date(now).toISOString() });
  r.status = "refunded";
  mail(db, now, r.patient.email, "refund", { first_name: r.patient.firstName, treatment: plainType(r.appointmentTypeName), practitioner: r.practitionerName, when: whenLong(r.originalStartsAtISO), when_short: whenShort(r.originalStartsAtISO), amount: euro(amount), clinic_phone: CLINIC_PHONE });
  audit(db, now, { actor: by === "clinic" ? "reception" : by, action: "rebook.refunded", amountMinor: amount });
  return { ok: true as const, rebook: r };
}

/** The scheduled jobs, run on each request: holds expire, untouched rebooks refund after 7 days. */
export function tick(db: Db, now: number) {
  const nowIso = new Date(now).toISOString();
  db.holds = db.holds.filter((h) => h.expiresAt > nowIso);
  for (const s of db.sessions) if (s.status === "open" && s.expiresAt < nowIso) s.status = "expired";
  for (const r of db.rebooks) if (r.status === "open" && r.refundBy < nowIso) rebookRefund(db, now, r, "system");
  for (const l of db.payLinks) {
    if (l.status !== "open" || l.expiresAt >= nowIso) continue;
    l.status = "expired";
    db.holds = db.holds.filter((h) => h.owner !== `paylink:${l.id}`);
    const entry = l.waitlistEntryId ? db.waitlist.find((e) => e.id === l.waitlistEntryId) : undefined;
    if (entry?.status === "offered" && entry.offer?.payLinkId === l.id) {
      delete entry.offer;
      Object.assign(entry, { status: "active", ignoredInRow: entry.ignoredInRow + 1 });
    }
  }
}

export { paidOnline };
