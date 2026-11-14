/** Reception's payment routes: book by phone, pay links, saved cards, take a payment for a past visit, invoices and KPIs. */
import { CLINIC_PHONE, euro, formatDublin } from "@/core/policy";
import { dayLong, whenShort } from "@/core/format";
import { toE164 } from "@/core/phone-booking";
import { VISIT_LINK_DAYS, VISIT_LOOKBACK_DAYS, suggestedVisitMinor, visitAmountRefusal, visitAppointmentRefusal } from "@/core/visit-payment";
import { BUSINESS, PRACTITIONERS, practitionerById, practitionerName, priceMinor, typeById } from "../clinic";
import { type CheckoutSession, type Db, audit, feeNetPaidMinor, nextNum, randomToken, sendEmail, stripeId } from "../db";
import { createAppointment, getAppointment, hold, isSlotAvailable, plusMinutes, releaseHold } from "../diary";
import { mail, newRecord, startCheckout } from "../flows";
import { kpiReport } from "../kpis";
import { createPayLink } from "../paylinks";
import { charge, entryFor } from "../stripe";
import { fail, ok, route } from "../router";

const BY = "Demo Owner (Owner)";
const plain = (n?: string) => (n ?? "").replace(/^\d+\.\s*/, "").replace(/ - .*$/, "");

// ---- Book a patient by phone

// Texts are switched on in the demo (they land in the demo inbox). Card-over-the-phone needs Stripe Elements, so it stays off.
route("GET", "/api/admin/phone-booking", () => ok({ email: true, sms: true, phoneCard: false }));

route("POST", "/api/admin/phone-booking", (db, now, req) => {
  const b = req.body ?? {};
  if (!db.flags.onlineBooking) return fail(503, { error: "Online booking is paused just now. (Online booking is paused, so no payment links can be sent.)" });
  const channel = b.channel === "sms" ? "sms" : "email";
  if (channel === "sms" && !toE164(b.patient?.phone ?? "")) return fail(400, { error: "That mobile number doesn't look right. Check it, or send the link by email instead." });
  const p = b.patient ?? {};
  const r = createPayLink(db, now, {
    practitionerId: String(b.practitionerId), appointmentTypeId: String(b.appointmentTypeId), startsAtISO: b.startsAtISO, by: BY, channel,
    patient: { firstName: p.firstName ?? "", lastName: p.lastName ?? "", email: p.email ?? "", phone: p.phone ?? "", ...(b.clinikoPatientId ? { clinikoPatientId: String(b.clinikoPatientId) } : {}) },
  });
  if ("error" in r) return fail(r.status, { error: r.error, code: r.code });
  return ok({ ok: true, id: r.link.id, url: `/pay/${r.link.token}`, expiresAt: r.link.expiresAt, amountMinor: r.link.amountMinor, sent: true });
});

route("POST", "/api/admin/saved-card", (db, now, req) => {
  const b = req.body ?? {};
  const pid = String(b.clinikoPatientId ?? "");
  if (b.action === "find") {
    const card = db.savedCards[pid];
    // A card is saved on the therapist's own Stripe account, so it only works for that therapist (or the clinic's account for clinic-paid staff).
    const account = practitionerById(String(b.practitionerId))?.account ?? null;
    return ok({ card: card && card.account === account ? { brand: card.brand, last4: card.last4 } : null });
  }
  if (b.action === "status" || b.action === "cancel") return fail(404, { error: "No such approval." });
  if (!db.flags.onlineBooking) return fail(503, { error: "Online booking is paused just now. (Online booking is paused.)" });
  const t = typeById(String(b.appointmentTypeId));
  const prac = practitionerById(String(b.practitionerId));
  if (!t || !prac) return fail(400, { error: "Invalid request." });
  if (b.amountMinor !== priceMinor(t.id)) return fail(409, { error: `The price is now ${euro(priceMinor(t.id))}, not ${euro(b.amountMinor)}. Tell the patient the new amount and tick again once they agree.`, code: "price_changed" });
  const card = db.savedCards[pid];
  if (!card || card.account !== prac.account) return fail(402, { fallback: true, code: "no_card", message: "There's no saved card for this patient with this therapist. Send them a payment link instead." });
  if (!isSlotAvailable(db, prac.id, t.id, b.startsAtISO, now)) return fail(409, { error: "Sorry, someone has just booked that time. Please choose another.", code: "slot_taken" });
  const patient = db.patients.find((x) => x.id === pid);
  if (!patient) return fail(404, { error: "Patient not found." });
  const pi = charge(db, now, { practitionerId: prac.id, amountMinor: priceMinor(t.id), description: `${plain(t.name)} ${whenShort(b.startsAtISO)}`, patientId: pid, card });
  const appt = createAppointment(db, now, { patientId: pid, practitionerId: prac.id, typeId: t.id, startsAt: b.startsAtISO, note: `Booked by phone by ${BY}; paid with saved card` });
  const rec = newRecord(appt, patient, now, "cliniko");
  rec.payments.push(entryFor(pi, "full"));
  db.bookings[appt.id] = rec;
  sendEmail(db, now, patient.email, `Booked: ${plain(t.name)}, ${whenShort(b.startsAtISO)}`, `Hi ${patient.first_name},\n\nYou're booked in with ${prac.first_name} ${prac.last_name} on ${formatDublin(b.startsAtISO)}. We've taken ${euro(pi.amount)} from your ${card.brand} ending ${card.last4}, as agreed on the phone.\n\n[Manage your booking](/manage)`);
  audit(db, now, { actor: "reception", by: BY, action: "phone.saved_card", appointmentId: appt.id, amountMinor: pi.amount });
  return ok({ ok: true, appointmentId: appt.id, amountMinor: pi.amount, message: `Paid ${euro(pi.amount)} with their saved card and booked. They've been emailed a confirmation.` });
});

// ---- The patient's side of a pay link (/pay/<token>)

const CALL = `Please call us on ${CLINIC_PHONE}.`;

route("GET", "/api/pay/:token", (db, _now, req) => {
  const l = db.payLinks.find((x) => x.token === req.params.token);
  if (!l) return fail(404, { error: "not_found" });
  const entry = l.waitlistEntryId ? db.waitlist.find((e) => e.id === l.waitlistEntryId) : undefined;
  return ok({
    status: l.status === "open" ? "pending" : l.status, firstName: l.patient.firstName, appointmentTypeName: plain(l.appointmentTypeName),
    practitionerName: practitionerName(l.practitionerId), startsAtISO: l.startsAtISO, durationMinutes: typeById(l.appointmentTypeId)?.duration_in_minutes ?? 45,
    amountMinor: l.amountMinor, expiresAt: l.expiresAt, waitlist: !!entry, needsDetails: false, leavePath: entry ? `/waitlist/leave/${entry.leaveToken}` : null,
  });
});

route("POST", "/api/pay/:token", (db, now, req) => {
  if (!db.flags.onlineBooking) return fail(503, { error: "Online booking is paused just now. Please call us and we'll book you in.", code: "paused" });
  const l = db.payLinks.find((x) => x.token === req.params.token);
  if (!l) return fail(404, { error: `This payment link isn't valid. ${CALL}`, code: "not_found" });
  if (l.status !== "open") {
    const why = l.status === "paid" ? "This appointment has already been paid for, so there's nothing more to do." : l.status === "expired" ? `This payment link has expired and the time is no longer held. ${CALL}` : `This payment link is no longer active. ${CALL}`;
    return fail(409, { error: why, code: l.status });
  }
  // Hand the time from the link's 2-hour hold to the payment page's hold.
  const t = typeById(l.appointmentTypeId)!;
  releaseHold(db, `paylink:${l.id}`);
  const r = startCheckout(db, now, { practitionerId: l.practitionerId, appointmentTypeId: l.appointmentTypeId, startsAtISO: l.startsAtISO, patient: { ...l.patient, dateOfBirth: "" } }, { payLinkId: l.id });
  hold(db, now, { owner: `paylink:${l.id}`, practitionerId: l.practitionerId, startsAt: l.startsAtISO, endsAt: plusMinutes(l.startsAtISO, t.duration_in_minutes) }, Math.max(1, (Date.parse(l.expiresAt) - now) / 60_000));
  if (!r.session) return fail(r.status ?? 409, { error: r.error, code: r.code });
  return ok({ url: `/demo-checkout?session=${encodeURIComponent(r.session.id)}` });
});

// ---- Take a payment for an appointment that's already happened

route("GET", "/api/staff/visit-payments", (db, now, req) => {
  const sp = req.url.searchParams;
  const appointmentId = sp.get("appointmentId");
  if (appointmentId) {
    const a = getAppointment(db, appointmentId);
    const p = a && db.patients.find((x) => x.id === a.patient_id);
    if (!a || !p) return fail(403, { error: "That isn't one of your appointments." });
    return ok({ firstName: p.first_name, lastName: p.last_name, email: p.email });
  }
  const practitioners = PRACTITIONERS.map((p) => ({ id: p.id, name: practitionerName(p.id) })).sort((a, b) => a.name.localeCompare(b.name));
  const pid = sp.get("practitionerId");
  if (!pid || !practitionerById(pid)) return ok({ anyone: true, practitioners, practitionerId: null, appointments: [] });
  const from = new Date(now - VISIT_LOOKBACK_DAYS * 86_400_000).toISOString();
  const nowIso = new Date(now).toISOString();
  const rows = db.appointments
    .filter((a) => a.practitioner_id === pid && !a.cancelled_at && a.starts_at >= from && a.starts_at <= nowIso)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    .slice(0, 80)
    .map((a) => {
      const rec = db.bookings[a.id];
      const feePaid = rec ? feeNetPaidMinor(rec) : 0;
      const price = priceMinor(a.appointment_type_id);
      const p = db.patients.find((x) => x.id === a.patient_id);
      const pending = db.visitPayments.find((v) => v.appointmentId === a.id && v.status === "pending" && v.expiresAt > nowIso);
      return {
        appointmentId: a.id, startsAtISO: a.starts_at, patientName: p ? `${p.first_name} ${p.last_name}` : "Patient", appointmentTypeName: plain(typeById(a.appointment_type_id)?.name) || "Appointment",
        priceMinor: price, paidMinor: feePaid, suggestedMinor: suggestedVisitMinor(price, feePaid), didNotArrive: a.did_not_arrive,
        pending: pending ? { amountMinor: pending.amountMinor, email: pending.email, createdAt: pending.createdAt } : null,
      };
    });
  audit(db, now, { actor: "reception", by: BY, action: "visit_payment.list", note: pid });
  return ok({ anyone: true, practitioners, practitionerId: pid, practitionerName: practitionerName(pid), paysTo: practitionerById(pid)!.account ? "therapist" : "clinic", appointments: rows });
});

function visitSession(db: Db, now: number, v: Db["visitPayments"][number]): CheckoutSession {
  const a = getAppointment(db, v.appointmentId)!;
  const p = db.patients.find((x) => x.id === a.patient_id)!;
  const s: CheckoutSession = {
    id: stripeId(db, "cs_test").replace(/_d/, "_"), status: "open", payment_status: "unpaid", account: practitionerById(v.practitionerId)?.account ?? null, amount: v.amountMinor,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 60_000).toISOString(),
    meta: {
      practitionerId: v.practitionerId, appointmentTypeId: a.appointment_type_id, businessId: BUSINESS.id, startsAtISO: a.starts_at,
      patient: { firstName: p.first_name, lastName: p.last_name, email: v.email, phone: p.phone, dateOfBirth: p.date_of_birth ?? "" },
      visitPaymentId: v.id, returnUrl: `/pay-visit/${v.token}?paid=1`,
    },
  };
  db.sessions.push(s);
  return s;
}

route("POST", "/api/staff/visit-payments", (db, now, req) => {
  const { appointmentId, email, amountMinor, method } = req.body ?? {};
  const amountProblem = visitAmountRefusal(amountMinor);
  if (amountProblem) return fail(400, { error: amountProblem });
  const a = getAppointment(db, String(appointmentId));
  if (!a) return fail(403, { error: "You can only take payments for your own appointments." });
  const refusal = visitAppointmentRefusal(a, now);
  if (refusal) return fail(400, { error: refusal });
  const p = db.patients.find((x) => x.id === a.patient_id)!;
  // A newer request replaces any earlier link for the same appointment.
  for (const old of db.visitPayments) if (old.appointmentId === a.id && old.status === "pending") old.status = "cancelled";
  const v = {
    id: `vp${nextNum(db)}`, token: randomToken(), status: "pending" as const, appointmentId: a.id, practitionerId: a.practitioner_id, clinikoPatientId: p.id,
    firstName: p.first_name, email: String(email).trim().toLowerCase(), appointmentTypeName: plain(typeById(a.appointment_type_id)?.name), startsAtISO: a.starts_at,
    amountMinor, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + VISIT_LINK_DAYS * 86_400_000).toISOString(), by: BY,
  };
  db.visitPayments.push(v);
  const link = `/pay-visit/${v.token}`;
  audit(db, now, { actor: "reception", by: BY, action: `visit_payment.${method === "page" ? "opened" : "emailed"}`, appointmentId: a.id, amountMinor });
  if (method === "page") return ok({ url: `/demo-checkout?session=${encodeURIComponent(visitSession(db, now, v).id)}`, link, id: v.id });
  mail(db, now, v.email, "visit_pay_link", {
    first_name: v.firstName, practitioner: practitionerName(v.practitionerId), treatment: v.appointmentTypeName, when: formatDublin(v.startsAtISO), when_short: whenShort(v.startsAtISO),
    amount: euro(amountMinor), link_until: dayLong(v.expiresAt), clinic_phone: CLINIC_PHONE,
  }, link);
  return ok({ sent: true, link, id: v.id, expiresAt: v.expiresAt });
});

const visitStatus = (v: Db["visitPayments"][number], now: number) => (v.status === "pending" && Date.parse(v.expiresAt) < now ? "expired" : v.status);

route("GET", "/api/visit-pay/:token", (db, now, req) => {
  const v = db.visitPayments.find((x) => x.token === req.params.token);
  if (!v) return fail(404, { error: "not_found" });
  return ok({ status: visitStatus(v, now), firstName: v.firstName, appointmentTypeName: v.appointmentTypeName, practitionerName: practitionerName(v.practitionerId), startsAtISO: v.startsAtISO, amountMinor: v.amountMinor, expiresAt: v.expiresAt });
});

route("POST", "/api/visit-pay/:token", (db, now, req) => {
  const v = db.visitPayments.find((x) => x.token === req.params.token);
  if (!v) return fail(404, { error: `This payment link isn't valid. ${CALL}`, code: "not_found" });
  const status = visitStatus(v, now);
  if (status !== "pending") {
    const why = status === "paid" ? "This appointment has already been paid for, so there's nothing more to do." : status === "expired" ? `This payment link has expired. ${CALL}` : `This payment link is no longer active. You may have been sent a newer one. ${CALL}`;
    return fail(409, { error: why, code: status });
  }
  return ok({ url: `/demo-checkout?session=${encodeURIComponent(visitSession(db, now, v).id)}` });
});

// ---- Invoices

route("GET", "/api/admin/invoices", (db, now, req) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date(now));
  const from = req.url.searchParams.get("from") ?? new Date(now - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = req.url.searchParams.get("to") ?? today;
  const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date(iso));
  const list = db.invoices.filter((i) => day(i.issuedAt) >= from && day(i.issuedAt) <= to).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  return ok({
    from, to, on: true, startsAt: "2026-10-27T00:00:00.000Z", waiting: 0, missingRefs: [],
    invoices: list.map((i) => ({
      number: i.number, kind: i.kind, issuedAt: i.issuedAt, patientName: i.patientName, patientEmail: i.email, practitionerName: practitionerName(i.practitionerId),
      description: i.lines[0]?.label ?? "", totalMinor: i.amountMinor, originalNumber: null, creditedMinor: 0,
      emailedAt: i.issuedAt, emailError: null, clinikoUploadedAt: i.issuedAt, clinikoError: null,
    })),
  });
});

route("POST", "/api/admin/invoices", (db, now, req) => {
  const inv = db.invoices.find((i) => i.number === req.body?.number);
  if (!inv) return fail(404, { error: "No invoice with that number." });
  if (req.body?.action === "resend") sendEmail(db, now, inv.email, `Your Northbank invoice ${inv.number}`, `Hi,\n\nHere's your invoice ${inv.number} for ${euro(inv.amountMinor)}, marked paid. (In the real system the PDF is attached.)\n\n[Open the invoice](/api/admin/invoices/pdf?number=${encodeURIComponent(inv.number)})`);
  audit(db, now, { actor: "reception", by: BY, action: req.body?.action === "resend" ? "invoice.resent" : "invoice.cliniko_retry", note: inv.number });
  return ok({ ok: true });
});

// ---- KPIs (the real report code, run on the demo diary)

route("GET", "/api/admin/kpis", (db, now) => ok({ data: kpiReport(db, now) }));
route("POST", "/api/admin/kpis", (db, now, req) => {
  if (req.body?.action === "target") {
    const euros = req.body.euros;
    db.kpiTargetMinor = euros ? Math.round(euros * 100) : null;
    audit(db, now, { actor: "reception", by: BY, action: "kpi.target" });
  }
  return ok({ data: kpiReport(db, now) });
});
