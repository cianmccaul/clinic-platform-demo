/**
 * Gift vouchers, switched on in the demo: bought on the pretend checkout
 * page, emailed with a code, then used at online checkout or at the desk.
 * Follows production's rules (core/vouchers.ts): a voucher is a ledger and
 * its balance is the sum of the lines; what an online booking is using is
 * set aside while the patient pays, so it can't be spent twice.
 */
import { addDays, dublinDay } from "@/core/policy";
import { availableOf, balanceOf, checkChar, codeCandidates, displayCode, expiryDay, isExpired, voucherEmail, type EventKind } from "@/core/vouchers";
import { practitionerName } from "./clinic";
import { type Db, type Voucher, type VoucherEvent, nextNum, sendEmail } from "./db";

export const today = (now: number) => dublinDay(new Date(now).toISOString());
export const balanceMinor = (v: Voucher) => balanceOf(v.events);

/** A valid code ("NB" + 11 characters + a check character) from a random source. */
export function newCode(rand: () => number = Math.random) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const body = Array.from({ length: 11 }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
  return `NB${body}${checkChar(body)}`;
}

/** Set aside by online bookings that are on the payment page right now. */
export function heldMinor(db: Db, v: Voucher, now: number) {
  const nowIso = new Date(now).toISOString();
  return db.sessions.filter((s) => s.status === "open" && s.expiresAt > nowIso && s.meta.voucher?.voucherId === v.id).reduce((sum, s) => sum + s.meta.voucher!.amountMinor, 0);
}
export const availableMinor = (db: Db, v: Voucher, now: number) => availableOf(balanceMinor(v), heldMinor(db, v, now));

export function findVoucher(db: Db, typed: string): Voucher | null {
  const candidates = codeCandidates(typed);
  if (!candidates) return null;
  return db.vouchers.find((v) => v.status !== "pending" && candidates.includes(v.code)) ?? null;
}

export function addEvent(db: Db, now: number, v: Voucher, e: Omit<VoucherEvent, "id" | "at"> & { kind: EventKind }) {
  const event: VoucherEvent = { id: `ve${nextNum(db)}`, at: new Date(now).toISOString(), ...e };
  v.events.push(event);
  return event;
}

export function createVoucher(db: Db, now: number, a: Pick<Voucher, "amountMinor" | "buyerName" | "buyerEmail" | "recipientName" | "recipientEmail" | "message" | "source"> & { sendOn?: string | null; status?: Voucher["status"]; rand?: () => number; daysAgo?: number }): Voucher {
  const at = now - (a.daysAgo ?? 0) * 86_400_000;
  const purchaseDay = today(at);
  let code = newCode(a.rand);
  while (db.vouchers.some((x) => x.code === code)) code = newCode(a.rand);
  const v: Voucher = {
    id: `v${nextNum(db)}`, code, status: a.status ?? "active", source: a.source, amountMinor: a.amountMinor, purchaseDay, expiresOn: expiryDay(purchaseDay),
    buyerName: a.buyerName, buyerEmail: a.buyerEmail, recipientName: a.recipientName, recipientEmail: a.recipientEmail, message: a.message, sendOn: a.sendOn ?? null, emailedAt: null, events: [],
  };
  if (v.status === "active") addEvent(db, at, v, { kind: "issued", amountMinor: v.amountMinor, byStaff: a.source === "desk" ? "Joan (Reception)" : null });
  db.vouchers.push(v);
  return v;
}

const forWords = (v: Voucher) => ({ code: v.code, amountMinor: v.amountMinor, balanceMinor: balanceMinor(v), purchaseDay: v.purchaseDay, expiresOn: v.expiresOn, buyerName: v.buyerName, recipientName: v.recipientName, message: v.message, bookOnline: true, sendOn: v.sendOn });

/** The voucher emails, in production's own words. Returns who was emailed. */
export function emailVoucher(db: Db, now: number, v: Voucher, opts: { resend?: boolean; only?: "buyer" | "recipient"; to?: string } = {}) {
  const sent: string[] = [];
  const check = `\n\n[Check what's left on it](/vouchers/balance)`;
  const scheduled = !!v.sendOn && v.sendOn > today(now);
  if (v.recipientEmail && opts.only !== "buyer" && (!scheduled || opts.resend)) {
    const m = voucherEmail(forWords(v), "recipient");
    sendEmail(db, now, opts.only === "recipient" && opts.to ? opts.to : v.recipientEmail, m.subject, m.text + check);
    sent.push(opts.only === "recipient" && opts.to ? opts.to : v.recipientEmail);
  }
  if (opts.only !== "recipient") {
    const m = voucherEmail(forWords(v), "buyer", { sentToRecipient: v.recipientEmail, resend: opts.resend, scheduledFor: scheduled ? v.sendOn : null });
    sendEmail(db, now, opts.to ?? v.buyerEmail, m.subject, m.text + check);
    sent.push(opts.to ?? v.buyerEmail);
  }
  v.emailedAt = new Date(now).toISOString();
  return sent;
}

/** The dashboard's view of one voucher (production's /api/admin/vouchers shape). */
export function voucherView(db: Db, v: Voucher, now: number) {
  const undone = new Set(v.events.map((e) => e.undoOf).filter(Boolean));
  return {
    id: v.id, code: displayCode(v.code), status: v.status === "cancelled" ? ("cancelled" as const) : ("active" as const), source: v.source, amountMinor: v.amountMinor, balanceMinor: balanceMinor(v),
    purchaseDay: v.purchaseDay, expiresOn: v.expiresOn, expired: isExpired(v.expiresOn, today(now)), buyerName: v.buyerName, buyerEmail: v.buyerEmail, recipientName: v.recipientName, recipientEmail: v.recipientEmail,
    message: v.message, paidBy: v.source === "online" ? "card online" : "card machine", paidOnline: v.source === "online", emailedAt: v.emailedAt, sendOn: v.sendOn && v.sendOn > today(now) ? v.sendOn : null,
    heldMinor: heldMinor(db, v, now), emailError: null,
    events: [...v.events].reverse().map((e) => ({
      id: e.id, at: e.at, kind: e.kind, amountMinor: e.amountMinor, practitionerName: e.practitionerId ? practitionerName(e.practitionerId) : null, treatmentDay: e.treatmentDay ?? null,
      byStaff: e.byStaff ?? null, note: e.note ?? "", undone: undone.has(e.id), unconfirmed: false,
    })),
  };
}

export { addDays };
