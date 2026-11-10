/**
 * Waitlist rules (clinic request, 26 Oct 2026).
 *
 * A patient joins the list for one treatment, with one therapist or "any",
 * and the days and parts of the day that suit them. When a time opens in
 * Cliniko that fits, they get a text (an email until Twilio is set up)
 * with a link to pay and book it. They have a window of 2 hours to accept;
 * if they don't, it moves to the next person (one person at a time: the time
 * is theirs alone for those 2 hours). Nothing is booked until they
 * pay (the same pay link and Stripe webhook as a phone booking).
 *
 * Pure, no I/O; unit-tested in tests/waitlist.test.ts.
 */
import { dublinDay } from "./policy.ts";
import { dayPart, timeShort, whenShort, type DayPart } from "./format.ts";
import { toE164 } from "./phone-booking.ts";
import { fillTemplate, type EmailOverrides } from "./email-templates.ts";

/** How long each patient has to accept an offer (26 Oct 2026). */
export const OFFER_WINDOW_MINUTES = 120;
/** No automatic offers when the time starts in under 3 hours: too late to act on. */
export const MIN_NOTICE_MINUTES = 180;
/** Manual offers from reception need at least this much notice. */
export const MIN_MANUAL_NOTICE_MINUTES = 30;
/** An offer window never runs past this long before the appointment. */
export const CLOSE_BEFORE_MINUTES = 60;
/** Messages are only sent between these Irish times (accepting is allowed any time inside the window). */
export const SEND_FROM_MINUTES = 8 * 60 + 30;
export const SEND_UNTIL_MINUTES = 20 * 60;

export const MAX_ACTIVE_ENTRIES = 2;
export const MAX_OFFERS_PER_DAY = 1;
export const MAX_OFFERS_PER_WEEK = 4;
export const PAUSE_AFTER_IGNORED = 3;
/** A place on the list lasts this long unless the patient picks an earlier end. */
export const MAX_ENTRY_DAYS = 60;

export type EntryStatus = "active" | "paused" | "offered" | "filled" | "cancelled" | "expired";
export const DAY_PARTS: DayPart[] = ["Morning", "Afternoon", "Evening"];

export type WaitlistEntry = {
  id: string; // sha256(token), first 32 hex: the token itself is only in the patient's emails
  status: EntryStatus;
  createdAt: string;
  practitionerId: string | "any";
  appointmentTypeId: string;
  appointmentTypeName: string;
  businessId: string;
  /** Irish calendar days, "YYYY-MM-DD". */
  fromDay: string;
  untilDay: string;
  /** 0 Sunday … 6 Saturday; empty = any day. */
  days: number[];
  /** Empty = any part of the day. */
  parts: DayPart[];
  patient: { firstName: string; lastName: string; email: string; phone: string };
  patientKind?: "new" | "returning" | "lapsed";
  wantsSms: boolean;
  /** ISO times of offers sent in the last 7 days (for the daily and weekly caps). */
  offerLog: string[];
  /** Offers that lapsed without payment, in a row. */
  ignoredInRow: number;
  lastOfferAt?: string;
  offer?: { payLinkId: string; startsAtISO: string; practitionerId: string; sentAt: string; expiresAt: string; channels: string[]; manual?: boolean };
  pausedReason?: string;
  closedAt?: string;
  /** Who put them on the list from the dashboard (staff label); unset when the patient joined online. */
  addedBy?: string;
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** 0 Sunday … 6 Saturday, in Irish time. */
export function dublinWeekday(iso: string) {
  const w = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", weekday: "short" }).format(new Date(iso));
  return WEEKDAYS[w] ?? 0;
}

/** Minutes since midnight in Ireland. */
export function dublinMinutes(iso: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** Does this opening fit the days, parts of the day and dates the patient chose? */
export function slotMatchesEntry(e: Pick<WaitlistEntry, "fromDay" | "untilDay" | "days" | "parts" | "practitionerId">, slot: { practitionerId: string; startsAtISO: string }) {
  if (e.practitionerId !== "any" && e.practitionerId !== slot.practitionerId) return false;
  const day = dublinDay(slot.startsAtISO);
  if (day < e.fromDay || day > e.untilDay) return false;
  if (e.days.length && !e.days.includes(dublinWeekday(slot.startsAtISO))) return false;
  if (e.parts.length && !e.parts.includes(dayPart(slot.startsAtISO))) return false;
  return true;
}

/** True between 08:30 and 20:00 Irish time, when messages may go out. */
export function withinSendHours(now = Date.now()) {
  const m = dublinMinutes(new Date(now).toISOString());
  return m >= SEND_FROM_MINUTES && m < SEND_UNTIL_MINUTES;
}

/**
 * When an offer made now for a time starting at `startsAtISO` runs out, or
 * null if it's too late to offer it. The window is 2 hours, but never runs
 * past 1 hour before the appointment (so an offer needs 3 hours' notice to
 * get its full 2 hours). Reception's manual offers may be shorter.
 */
export function offerExpiry(startsAtISO: string, now = Date.now(), manual = false): string | null {
  const start = Date.parse(startsAtISO);
  if (Number.isNaN(start)) return null;
  const noticeMin = (start - now) / 60_000;
  if (noticeMin < (manual ? MIN_MANUAL_NOTICE_MINUTES : MIN_NOTICE_MINUTES)) return null;
  const closeBefore = manual && noticeMin < MIN_NOTICE_MINUTES ? 15 : CLOSE_BEFORE_MINUTES;
  const end = Math.min(now + OFFER_WINDOW_MINUTES * 60_000, start - closeBefore * 60_000);
  return end > now ? new Date(end).toISOString() : null;
}

/** Why this entry can't be offered anything right now, or null if it can. */
export function ineligibleReason(e: WaitlistEntry, now = Date.now()): string | null {
  if (e.status !== "active") return e.status === "paused" ? "paused" : `status ${e.status}`;
  if (e.ignoredInRow >= PAUSE_AFTER_IGNORED) return "paused after ignored offers";
  const log = e.offerLog.map(Date.parse).filter((t) => now - t < 7 * 86_400_000);
  const today = dublinDay(new Date(now).toISOString());
  if (log.filter((t) => dublinDay(new Date(t).toISOString()) === today).length >= MAX_OFFERS_PER_DAY) return "already offered a time today";
  if (log.length >= MAX_OFFERS_PER_WEEK) return "offer limit for this week reached";
  if (dublinDay(new Date(now).toISOString()) > e.untilDay) return "past its end date";
  return null;
}

/**
 * Who is offered a time first: the therapist's own named waitlist before
 * "any therapist", then whoever has gone longest without an offer, then
 * whoever joined first. Returns eligible entries in order.
 */
export function rankEntries(entries: WaitlistEntry[], slot: { practitionerId: string; startsAtISO: string }, now = Date.now()) {
  return entries
    .filter((e) => !ineligibleReason(e, now) && slotMatchesEntry(e, slot))
    .sort((a, b) => {
      const named = Number(b.practitionerId === slot.practitionerId) - Number(a.practitionerId === slot.practitionerId);
      if (named) return named;
      const la = a.lastOfferAt ? Date.parse(a.lastOfferAt) : 0;
      const lb = b.lastOfferAt ? Date.parse(b.lastOfferAt) : 0;
      if (la !== lb) return la - lb;
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
}

/** One patient can't be on the list too many times, or twice for the same thing. */
export function personKey(p: { email: string; firstName: string }) {
  return `${p.email.trim().toLowerCase()}|${p.firstName.trim().toLowerCase()}`;
}

export function joinRefusal(
  existing: Pick<WaitlistEntry, "practitionerId" | "appointmentTypeId" | "status">[],
  wanted: { practitionerId: string; appointmentTypeId: string },
  voice: "patient" | "staff" = "patient"
): string | null {
  const live = existing.filter((e) => e.status === "active" || e.status === "paused" || e.status === "offered");
  if (live.some((e) => e.appointmentTypeId === wanted.appointmentTypeId && e.practitionerId === wanted.practitionerId))
    return voice === "staff"
      ? "They're already on the waitlist for this treatment and therapist."
      : "You're already on the waitlist for this. We'll be in touch when a time opens.";
  if (live.length >= MAX_ACTIVE_ENTRIES)
    return voice === "staff"
      ? `They're already on the waitlist for ${MAX_ACTIVE_ENTRIES} things, the most anyone can have. Remove one of their places first.`
      : `You can be on the waitlist for up to ${MAX_ACTIVE_ENTRIES} things at once. Leave one first, using the link in your email.`;
  return null;
}

/** Last day an entry can run to: what the patient asked for, never more than MAX_ENTRY_DAYS. */
export function clampUntilDay(todayDay: string, wantedUntil: string | undefined) {
  const max = new Date(Date.parse(`${todayDay}T12:00:00Z`) + MAX_ENTRY_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (!wantedUntil || wantedUntil < todayDay) return max;
  return wantedUntil > max ? max : wantedUntil;
}

/**
 * How a patient is told about their place and offers. Text only once texts are set up
 * (Cian, 27 Oct 2026: "text messages for waitlist, no email"), as long as they agreed to
 * texts and the number is a mobile. Until Twilio is set up, or as the fallback, email.
 */
export function channelsFor(e: Pick<WaitlistEntry, "wantsSms" | "patient">, smsConfigured: boolean): ("email" | "sms")[] {
  return e.wantsSms && smsConfigured && isIrishMobile(e.patient.phone) ? ["sms"] : ["email"];
}

/**
 * Waitlist texts go to Irish mobiles only (+353 8x). Anyone can join the list, so this stops it
 * being used to send texts to premium-rate or foreign numbers on Northbank's bill (audit M6).
 * Other numbers are kept and told by email instead.
 */
export const isIrishMobile = (raw: string | null | undefined) => /^\+3538\d{8}$/.test(toE164(raw ?? "") ?? "");

/** Most "you're on the waitlist" texts sent in a day; after that the confirmation goes by email. */
export const JOIN_TEXTS_PER_DAY = 60;

// ---- The words ----

/**
 * The offer text: the date and one link, never the treatment or any health detail (texts show
 * on lock screens). The link's page has both "book and pay" and "pause or leave the waitlist",
 * so one link is enough and the text stays short. Plain characters only (no euro sign, emoji or
 * curly quotes), or Twilio switches encoding and the text costs double.
 */
export function waitlistOfferSms(o: { url: string; startsAtISO: string; expiresAtISO: string; phone: string }) {
  // Kept to one text (160 characters) with a real pay link: the page it opens has the clinic's phone number.
  return `Northbank: a time is free for you, ${whenShort(o.startsAtISO)}, held until ${timeShort(o.expiresAtISO)}. Book or leave the waitlist: ${o.url}`;
}

/** Sent when someone joins, once texts are set up: the link to pause or leave at any time. */
export function waitlistJoinedSms(o: { leaveUrl: string; phone: string }) {
  return (
    `Northbank: you're on the waitlist. We'll text you when a time opens up; you'll have ${OFFER_WINDOW_MINUTES / 60} hours to book it. ` +
    `To pause or leave: ${o.leaveUrl} Replies aren't read; call ${o.phone}.`
  );
}

export function waitlistOfferEmail(
  o: {
    firstName: string;
    treatment: string;
    practitioner: string;
    startsAtISO: string;
    expiresAtISO: string;
    amount: string;
    phone: string;
    leaveUrl: string | null;
  },
  overrides?: EmailOverrides | null
) {
  const mail = fillTemplate(
    "waitlist_offer",
    {
      first_name: o.firstName,
      treatment: o.treatment,
      practitioner: o.practitioner,
      when_short: whenShort(o.startsAtISO),
      amount: o.amount,
      hold_until: timeShort(o.expiresAtISO),
      waitlist_name: o.firstName,
      leave_link: o.leaveUrl,
      clinic_phone: o.phone,
    },
    overrides
  );
  return { subject: mail.subject, text: mail.text, button: mail.button };
}

export function waitlistJoinedEmail(
  o: { firstName: string; treatment: string; practitioner: string; phone: string; leaveUrl: string; sms: boolean; smsAvailable: boolean },
  overrides?: EmailOverrides | null
) {
  // `sms`: offers to this person go by text (texts set up, consent, an Irish mobile).
  const how = o.sms && o.smsAvailable ? "a text message" : "an email";
  const mail = fillTemplate(
    "waitlist_joined",
    { first_name: o.firstName, treatment: o.treatment, practitioner: o.practitioner, offer_by: how, leave_link: o.leaveUrl, clinic_phone: o.phone },
    overrides
  );
  return { subject: mail.subject, text: mail.text };
}

/** Hours between a time being offered and the appointment (for the notice KPI). */
export const noticeHours = (startsAtISO: string, now = Date.now()) => Math.round(((Date.parse(startsAtISO) - now) / 3_600_000) * 10) / 10;

