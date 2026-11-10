/** The waitlist: patients join (or reception adds them); when a time opens up that suits them, they're sent a pay link that holds it for 2 hours. */
import { CLINIC_PHONE, addDays, dublinDay } from "@/core/policy";
import { MIN_MANUAL_NOTICE_MINUTES, MIN_NOTICE_MINUTES, clampUntilDay, ineligibleReason, joinRefusal, offerExpiry, rankEntries, slotMatchesEntry } from "@/core/waitlist";
import type { DayPart } from "@/core/format";
import { BUSINESS, PRACTITIONERS, practitionerById, practitionerName, typeById } from "../clinic";
import { type Db, type WaitlistEntry, audit, norm, nextNum, randomToken } from "../db";
import { availableTimes } from "../diary";
import { mail } from "../flows";
import { createPayLink, pendingLinkForSlot } from "../paylinks";
import { fail, ok, route } from "../router";

const BY = "Demo Owner (Owner)";
const plain = (n?: string) => (n ?? "").replace(/^\d+\.\s*/, "");
const live = (e: WaitlistEntry) => e.status === "active" || e.status === "paused" || e.status === "offered";

/** Open times that suit an entry, from `fromMs` up to `toMs`, soonest first. */
function openTimesFor(db: Db, now: number, e: Pick<WaitlistEntry, "practitionerId" | "appointmentTypeId" | "fromDay" | "untilDay" | "days" | "parts">, fromMs: number, toMs: number) {
  const pids = e.practitionerId === "any" ? PRACTITIONERS.filter((p) => p.offers.includes(e.appointmentTypeId)).map((p) => p.id) : [e.practitionerId];
  const fromDay = dublinDay(new Date(fromMs).toISOString());
  const toDay = dublinDay(new Date(toMs).toISOString());
  const out: { practitionerId: string; startsAtISO: string }[] = [];
  for (const pid of pids) {
    for (const t of availableTimes(db, pid, e.appointmentTypeId, fromDay, toDay, now)) {
      const ms = Date.parse(t);
      if (ms < fromMs || ms > toMs || pendingLinkForSlot(db, pid, t)) continue;
      if (slotMatchesEntry(e, { practitionerId: pid, startsAtISO: t })) out.push({ practitionerId: pid, startsAtISO: t });
    }
  }
  return out.sort((a, b) => a.startsAtISO.localeCompare(b.startsAtISO));
}

const withNames = (times: { practitionerId: string; startsAtISO: string }[]) => times.map((t) => ({ ...t, practitionerName: practitionerName(t.practitionerId) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function join(db: Db, now: number, b: any, by?: string) {
  const staff = !!by;
  const t = typeById(String(b.appointmentTypeId ?? ""));
  if (!t) return fail(400, { error: "Pick a treatment.", code: "bad_type" });
  const pid = String(b.practitionerId ?? "any");
  if (pid !== "any" && !practitionerById(pid)?.offers.includes(t.id)) return fail(400, { error: "That therapist doesn't offer this treatment.", code: "bad_practitioner" });
  const p = b.patient ?? {};
  if (!p.firstName || !p.lastName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email ?? "") || !p.phone) return fail(400, { error: "Please fill in the name, email and mobile number." });
  if (!b.consent) return fail(400, { error: staff ? "Tick the box to confirm the patient agreed to be contacted about the waitlist." : "Please tick the box to say we can contact you about the waitlist." });

  const mine = db.waitlist.filter((e) => norm(e.patient.email) === norm(p.email) && e.patient.firstName.trim().toLowerCase() === String(p.firstName).trim().toLowerCase());
  const refusal = joinRefusal(mine, { practitionerId: pid, appointmentTypeId: t.id }, staff ? "staff" : "patient");
  if (refusal) return fail(409, { error: refusal, code: "limit" });

  const today = dublinDay(new Date(now).toISOString());
  const entry: WaitlistEntry = {
    id: `wl${nextNum(db)}`, leaveToken: randomToken(), status: "active", createdAt: new Date(now).toISOString(),
    practitionerId: pid, appointmentTypeId: t.id, appointmentTypeName: t.name, businessId: BUSINESS.id,
    fromDay: today, untilDay: clampUntilDay(today, b.untilDay),
    days: [...new Set<number>((b.days ?? []).map(Number))].sort(), parts: [...new Set<DayPart>(b.parts ?? [])],
    patient: { firstName: String(p.firstName).trim(), lastName: String(p.lastName).trim(), email: String(p.email).trim(), phone: String(p.phone).trim() },
    ...(b.visit ? { patientKind: b.visit } : {}), wantsSms: !!b.wantsSms, offerLog: [], ignoredInRow: 0, ...(by ? { addedBy: by } : {}),
  };

  // If a time that fits is already open, book it instead of waiting.
  const from = now + MIN_NOTICE_MINUTES * 60_000;
  const to = Math.min(Date.parse(`${entry.untilDay}T23:00:00Z`), now + 28 * 86_400_000);
  const open = to > from ? openTimesFor(db, now, entry, from, to) : [];
  if (open.length) {
    return fail(409, {
      error: staff ? "There's already a time that fits what they chose, so book it for them instead (Book a patient in)." : "There's already a time that fits. You can book it now, no waiting needed.",
      code: "times_available",
      times: withNames(open.slice(0, staff ? 5 : 3)),
    });
  }

  db.waitlist.push(entry);
  mail(db, now, entry.patient.email, "waitlist_joined", {
    first_name: entry.patient.firstName, treatment: plain(t.name).replace(/ - .*$/, ""), practitioner: pid === "any" ? "any of our therapists" : practitionerName(pid),
    offer_by: "an email", leave_link: `/waitlist/leave/${entry.leaveToken}`, clinic_phone: CLINIC_PHONE,
  }, `/waitlist/leave/${entry.leaveToken}`, "Leave or pause my place");
  audit(db, now, { actor: staff ? "reception" : "patient", by, action: staff ? "waitlist.added" : "waitlist.joined" });
  return ok({ ok: true, id: entry.id, told: "email", until: entry.untilDay, message: staff ? `Added to the waitlist. ${entry.patient.firstName} has been emailed a link to pause or leave the waitlist.` : undefined });
}

/** Offer a time to one entry. Manual offers (from the board) may have less notice. */
function offer(db: Db, now: number, e: WaitlistEntry, slot: { practitionerId: string; startsAtISO: string }, manual: boolean, by: string) {
  if (!db.flags.onlineBooking) return { ok: false as const, reason: "paused" };
  if (e.status !== "active") return { ok: false as const, reason: "not_active" };
  const expiresAt = offerExpiry(slot.startsAtISO, now, manual);
  if (!expiresAt) return { ok: false as const, reason: "too_late" };
  const r = createPayLink(db, now, { practitionerId: slot.practitionerId, appointmentTypeId: e.appointmentTypeId, startsAtISO: slot.startsAtISO, patient: { ...e.patient }, by, channel: "email", waitlistEntryId: e.id });
  if ("error" in r) return { ok: false as const, reason: r.code === "link_pending" ? "slot_pending" : "slot_taken" };
  r.link.expiresAt = expiresAt;
  const at = new Date(now).toISOString();
  Object.assign(e, { status: "offered", lastOfferAt: at, offerLog: [...e.offerLog, at], offer: { payLinkId: r.link.id, startsAtISO: slot.startsAtISO, practitionerId: slot.practitionerId, sentAt: at, expiresAt, channels: ["email"], manual } });
  return { ok: true as const, sent: ["email"] };
}

function withdraw(db: Db, e: WaitlistEntry) {
  if (!e.offer) return;
  const link = db.payLinks.find((l) => l.id === e.offer!.payLinkId);
  if (link && link.status === "open") link.status = "cancelled";
  db.holds = db.holds.filter((h) => h.owner !== `paylink:${e.offer!.payLinkId}`);
}

function sweep(db: Db, now: number) {
  let offers = 0;
  const lists = new Set<string>();
  for (const e of db.waitlist.filter((x) => x.status === "active")) {
    lists.add(`${e.appointmentTypeId}|${e.practitionerId}`);
    if (ineligibleReason(e, now)) continue;
    const times = openTimesFor(db, now, e, now + MIN_NOTICE_MINUTES * 60_000, now + 14 * 86_400_000);
    // Offer the soonest time to whoever ranks first for it.
    for (const slot of times) {
      const first = rankEntries(db.waitlist, slot, now)[0];
      if (first?.id !== e.id) continue;
      if (offer(db, now, e, slot, false, "Waitlist").ok) {
        offers++;
        break;
      }
    }
  }
  return { groups: lists.size, offers };
}

function stats(db: Db) {
  const links = db.payLinks.filter((l) => l.waitlistEntryId);
  return {
    offers: links.length,
    filled: db.waitlist.filter((e) => e.status === "filled").length,
    lapsed: links.filter((l) => l.status === "expired").length,
    refunded: db.rebooks.filter((r) => links.some((l) => l.status === "rebook" && l.patient.email === r.patient.email)).length,
    email: links.length,
  };
}

function shape(e: WaitlistEntry, now: number) {
  return {
    id: e.id, status: e.status, createdAt: e.createdAt, closedAt: e.closedAt ?? null,
    patientName: `${e.patient.firstName} ${e.patient.lastName}`, patientEmail: e.patient.email, patientPhone: e.patient.phone, addedBy: e.addedBy ?? null, wantsSms: e.wantsSms,
    treatment: plain(e.appointmentTypeName), practitioner: e.practitionerId === "any" ? null : practitionerName(e.practitionerId),
    days: e.days, parts: e.parts, untilDay: e.untilDay, ignoredInRow: e.ignoredInRow, lastOfferAt: e.lastOfferAt ?? null,
    blocked: e.status === "active" ? ineligibleReason(e, now) : e.status === "paused" ? (e.pausedReason === "patient" ? "paused by the patient" : "paused by reception") : null,
    offer: e.offer ? { startsAtISO: e.offer.startsAtISO, practitioner: practitionerName(e.offer.practitionerId), expiresAt: e.offer.expiresAt, channels: e.offer.channels, manual: !!e.offer.manual } : null,
  };
}

// ---- patients

route("GET", "/api/waitlist", () => ok({ smsAvailable: false }));
route("POST", "/api/waitlist", (db, now, req) => join(db, now, req.body ?? {}));

route("GET", "/api/waitlist/:token", (db, _now, req) => {
  const e = db.waitlist.find((x) => x.leaveToken === req.params.token);
  if (!e) return fail(404, { error: "not_found" });
  return ok({
    status: e.status, firstName: e.patient.firstName, treatment: plain(e.appointmentTypeName), practitioner: e.practitionerId === "any" ? null : practitionerName(e.practitionerId),
    days: e.days, parts: e.parts, untilDay: e.untilDay, hasOffer: e.status === "offered",
  });
});

route("POST", "/api/waitlist/:token", (db, now, req) => {
  const e = db.waitlist.find((x) => x.leaveToken === req.params.token);
  if (!e) return fail(404, { error: "not_found" });
  const action = req.body?.action;
  if (!live(e)) return ok({ ok: true, status: e.status });
  if (action === "leave") {
    withdraw(db, e);
    delete e.offer;
    Object.assign(e, { status: "cancelled", closedAt: new Date(now).toISOString() });
    audit(db, now, { actor: "patient", action: "waitlist.left" });
    return ok({ ok: true, status: "cancelled" });
  }
  if (action === "pause" && e.status === "active") Object.assign(e, { status: "paused", pausedReason: "patient" });
  if (action === "resume" && e.status === "paused") {
    delete e.pausedReason;
    Object.assign(e, { status: "active", ignoredInRow: 0 });
  }
  audit(db, now, { actor: "patient", action: `waitlist.${action}` });
  return ok({ ok: true, status: e.status });
});

// ---- reception's board

route("GET", "/api/admin/waitlist", (db, now, req) => {
  const timesFor = req.url.searchParams.get("times");
  if (timesFor) {
    const e = db.waitlist.find((x) => x.id === timesFor);
    if (!e) return fail(404, { error: "That place is no longer on the list." });
    const from = now + MIN_MANUAL_NOTICE_MINUTES * 60_000;
    const all = { ...e, days: [], parts: [], fromDay: dublinDay(new Date(now).toISOString()), untilDay: addDays(dublinDay(new Date(now).toISOString()), 15) };
    return ok({ times: withNames(openTimesFor(db, now, all, from, from + 14 * 86_400_000).slice(0, 40)) });
  }
  const twoWeeksAgo = new Date(now - 14 * 86_400_000).toISOString();
  const open = db.waitlist.filter(live).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const closed = db.waitlist.filter((e) => !live(e) && (e.closedAt ?? "") >= twoWeeksAgo).sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
  return ok({ smsAvailable: false, stats: stats(db), open: open.map((e) => shape(e, now)), closed: closed.map((e) => shape(e, now)) });
});

route("POST", "/api/admin/waitlist", (db, now, req) => {
  const body = req.body ?? {};
  if (body.action === "sweep") {
    const r = sweep(db, now);
    audit(db, now, { actor: "reception", by: BY, action: "waitlist.sweep_now", note: `${r.offers} offers` });
    return ok({ ok: true, message: `Checked ${r.groups} lists: ${r.offers} offer${r.offers === 1 ? "" : "s"} sent.`, summary: r });
  }
  if (body.action === "add") return join(db, now, body, BY);

  const e = db.waitlist.find((x) => x.id === body.id);
  if (!e) return fail(404, { error: "That place is no longer on the list." });
  if (body.action === "pause" || body.action === "resume") {
    if (body.action === "pause" && e.status === "active") Object.assign(e, { status: "paused", pausedReason: "reception" });
    if (body.action === "resume" && e.status === "paused") {
      delete e.pausedReason;
      Object.assign(e, { status: "active", ignoredInRow: 0 });
    }
    audit(db, now, { actor: "reception", by: BY, action: `waitlist.${body.action}` });
    return ok({ ok: true, message: e.status === "paused" ? "Paused." : "Back on the list." });
  }
  if (body.action === "remove") {
    withdraw(db, e);
    delete e.offer;
    Object.assign(e, { status: "cancelled", closedAt: new Date(now).toISOString() });
    audit(db, now, { actor: "reception", by: BY, action: "waitlist.removed" });
    return ok({ ok: true, message: "Removed from the waitlist." });
  }
  if (body.action === "withdraw") {
    if (e.status !== "offered") return fail(409, { error: "They don't have an offer right now." });
    withdraw(db, e);
    delete e.offer;
    Object.assign(e, { status: "active", offerLog: e.offerLog.slice(0, -1) });
    audit(db, now, { actor: "reception", by: BY, action: "waitlist.withdrawn" });
    return ok({ ok: true, message: "Offer withdrawn. The time is free again." });
  }
  // offer
  const r = offer(db, now, e, { practitionerId: String(body.practitionerId), startsAtISO: String(body.startsAtISO) }, true, BY);
  if (r.ok) return ok({ ok: true, message: `Offer sent by ${r.sent.join(" and ")}.` });
  const why: Record<string, string> = {
    paused: "Online booking is paused, so nothing can be offered.",
    too_late: `That time is too close to offer (needs at least ${MIN_MANUAL_NOTICE_MINUTES} minutes).`,
    not_active: "They aren't waiting right now (already offered a time, or no longer on the list).",
    slot_pending: "A payment link for that time is already waiting for someone.",
    slot_taken: "That time has just been taken.",
  };
  return fail(409, { error: why[r.reason] ?? "Couldn't make the offer." });
});
