/**
 * Payment links: a phone booking or a waitlist offer holds the time for two
 * hours and sends the patient a link. The appointment is only made in the
 * diary once they pay (the same webhook as an online booking).
 */
import { CLINIC_PHONE, EXTRAS_SENTENCE, euro } from "@/core/policy";
import { whenLong, whenShort } from "@/core/format";
import { PAY_LINK_HOLD_SECONDS, payLinkSms } from "@/core/phone-booking";
import { waitlistOfferSms } from "@/core/waitlist";
import { practitionerName, priceMinor, typeById } from "./clinic";
import { type Db, type PayLink, audit, nextNum, randomToken, sendText } from "./db";
import { hold, isSlotAvailable, plusMinutes } from "./diary";
import { mail } from "./flows";

const plain = (n?: string) => (n ?? "").replace(/^\d+\.\s*/, "").replace(/ - .*$/, "");
const timeOnly = (iso: string) => new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export function pendingLinkForSlot(db: Db, practitionerId: string, startsAtISO: string) {
  return db.payLinks.find((l) => l.status === "open" && l.practitionerId === practitionerId && l.startsAtISO === startsAtISO);
}

export function createPayLink(
  db: Db,
  now: number,
  a: { practitionerId: string; appointmentTypeId: string; startsAtISO: string; patient: PayLink["patient"]; by: string; channel: "email" | "sms"; waitlistEntryId?: string },
): { link: PayLink } | { error: string; code?: string; status: number } {
  const t = typeById(a.appointmentTypeId);
  if (!t) return { error: "That treatment isn't bookable.", status: 400 };
  const waiting = pendingLinkForSlot(db, a.practitionerId, a.startsAtISO);
  if (waiting) {
    return { error: `A payment link for this time was already sent to ${waiting.patient.firstName} ${waiting.patient.lastName}. Cancel it under "Phone bookings waiting for payment" first.`, code: "link_pending", status: 409 };
  }
  if (!isSlotAvailable(db, a.practitionerId, t.id, a.startsAtISO, now)) return { error: "Sorry, someone has just booked that time. Please choose another.", code: "slot_taken", status: 409 };
  const id = `pl${nextNum(db)}`;
  const expiresAt = new Date(now + PAY_LINK_HOLD_SECONDS * 1000).toISOString();
  hold(db, now, { owner: `paylink:${id}`, practitionerId: a.practitionerId, startsAt: a.startsAtISO, endsAt: plusMinutes(a.startsAtISO, t.duration_in_minutes) }, PAY_LINK_HOLD_SECONDS / 60);
  const link: PayLink = {
    id, token: randomToken(), status: "open", createdAt: new Date(now).toISOString(), expiresAt,
    sentTo: a.channel === "sms" ? { phone: a.patient.phone } : { email: a.patient.email },
    practitionerId: a.practitionerId, appointmentTypeId: t.id, appointmentTypeName: t.name, startsAtISO: a.startsAtISO, amountMinor: priceMinor(t.id),
    patient: a.patient, by: a.by, ...(a.waitlistEntryId ? { waitlistEntryId: a.waitlistEntryId } : {}),
  };
  db.payLinks.push(link);
  const facts = {
    first_name: a.patient.firstName, treatment: plain(t.name), practitioner: practitionerName(a.practitionerId),
    when: whenLong(a.startsAtISO), when_short: whenShort(a.startsAtISO), amount: euro(link.amountMinor), hold_until: timeOnly(expiresAt), clinic_phone: CLINIC_PHONE,
  };
  // Texts are on in the demo: a text carries the date and one link, never the treatment (texts show on lock screens).
  if (a.channel === "sms") {
    const words = a.waitlistEntryId ? waitlistOfferSms : payLinkSms;
    sendText(db, now, a.patient.phone, `${words({ url: "the link below.", startsAtISO: a.startsAtISO, expiresAtISO: expiresAt, phone: CLINIC_PHONE }).trim()}\n\n[Open the link](/pay/${link.token})`);
  } else if (a.waitlistEntryId) {
    const entry = db.waitlist.find((e) => e.id === a.waitlistEntryId)!;
    mail(db, now, a.patient.email, "waitlist_offer", { ...facts, waitlist_name: `${a.patient.firstName} ${a.patient.lastName}`, leave_link: `/waitlist/leave/${entry.leaveToken}` }, `/pay/${link.token}`);
  } else {
    mail(db, now, a.patient.email, "pay_link", { ...facts, extras_sentence: EXTRAS_SENTENCE }, `/pay/${link.token}`);
  }
  audit(db, now, { actor: "reception", by: a.by, action: a.waitlistEntryId ? "waitlist.offered" : "paylink.created", amountMinor: link.amountMinor, note: `by ${a.channel}` });
  return { link };
}
