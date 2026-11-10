/**
 * Gift vouchers (plan-2026-10-28-gift-vouchers, decided 28 Oct 2026).
 *
 * A voucher is a euro amount, bought online (paid to the clinic's own Stripe
 * account) or at the desk, used towards any treatment in one visit or several.
 * It lasts 5 years from purchase (Consumer Protection (Gift Vouchers) Act 2019:
 * at least 5 years). Every change is a line in a ledger; the balance is the sum.
 * When it's used with a therapist, the clinic pays that therapist the amount
 * used (monthly statement).
 *
 * Pure, no I/O; tested in tests/vouchers.test.ts.
 */
import { dayText, euroText } from "./hub-invoice.ts";
import { CLINIC_EMAIL, CLINIC_PHONE } from "./policy.ts";
import { fillTemplate, type EmailOverrides } from "./email-templates.ts";

export const VOUCHER_YEARS = 5;
export const MIN_VOUCHER_MINOR = 10_00;
export const MAX_VOUCHER_MINOR = 500_00;
/** The amounts offered first on the buy page; any whole euro amount in range is allowed. */
export const SUGGESTED_MINOR = [50_00, 75_00, 100_00, 150_00];
export const MAX_MESSAGE = 300;
export const VOUCHER_PREFIX = "NB";

export type VoucherSource = "online" | "desk" | "imported";
export type VoucherStatus = "pending" | "active" | "cancelled";
export type EventKind = "issued" | "redeemed" | "undone" | "refunded" | "cancelled" | "adjusted";

// No 0/O or 1/I, so a code read out over the phone or copied from paper can't be mistaken.
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const BODY = 11; // random characters; one check character follows

/** A check character over the body, so a single mistyped or swapped character is caught. */
export function checkChar(body: string) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const v = CODE_ALPHABET.indexOf(body[i]);
    if (v < 0) return null;
    sum += v * (i % 2 === 0 ? 3 : 1) + i;
  }
  return CODE_ALPHABET[sum % CODE_ALPHABET.length];
}

/** A new code, stored as "NB" + 12 characters. `random` gives values 0..255 (crypto in the app). */
export function makeCode(random: (n: number) => Uint8Array) {
  // 256 is a multiple of 32, so taking each byte mod 32 is unbiased.
  const body = [...random(BODY)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `${VOUCHER_PREFIX}${body}${checkChar(body)}`;
}

/** Whether a stored code is one the Hub made (imported Vaoucher codes keep their own shape). */
export function isHubCode(code: string) {
  if (code.length !== 2 + BODY + 1 || !code.startsWith(VOUCHER_PREFIX)) return false;
  const body = code.slice(2, 2 + BODY);
  return checkChar(body) === code.slice(-1);
}

/**
 * "NB7KQ4X9TP2HRM" → "NB-…-2HRM": enough to tell which voucher, not enough to spend it. For
 * places others see (Cliniko notes every user reads, invoices sent on to insurers).
 */
export function maskCode(code: string) {
  const shown = displayCode(code);
  return shown.length > 8 ? `${shown.slice(0, 3)}…${shown.slice(-4)}` : shown;
}

/** "NB7KQ4X9TP2HRM" → "NB-7KQ4-X9TP-2HRM"; other codes as stored. */
export function displayCode(code: string) {
  if (!isHubCode(code)) return code;
  const rest = code.slice(2);
  return `${VOUCHER_PREFIX}-${rest.slice(0, 4)}-${rest.slice(4, 8)}-${rest.slice(8)}`;
}

/**
 * What someone typed, as stored: capitals and digits only (spaces, dashes and
 * dots dropped). The codes to try: as typed, and with "NB" in front when it was
 * left off. Null if it can't be a code at all.
 */
export function codeCandidates(typed: string): string[] | null {
  const s = typed.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length < 4 || s.length > 40) return null;
  const out = [s];
  if (!s.startsWith(VOUCHER_PREFIX) && s.length === BODY + 1) out.push(`${VOUCHER_PREFIX}${s}`);
  return out;
}

/** Whether a typed Hub-style code has a wrong character (so we can say "check the code" rather than "not found"). */
export function looksMistyped(typed: string) {
  const c = codeCandidates(typed);
  if (!c) return false;
  const hubShaped = c.find((x) => x.length === 2 + BODY + 1 && x.startsWith(VOUCHER_PREFIX));
  return !!hubShaped && !isHubCode(hubShaped);
}

/** A whole euro amount the buy page and the desk accept, in cents; null if not allowed. */
export function voucherAmountMinor(eur: unknown): number | null {
  const n = typeof eur === "string" ? Number(eur.trim().replace(/^€/, "")) : typeof eur === "number" ? eur : NaN;
  if (!Number.isInteger(n)) return null;
  const minor = n * 100;
  return minor >= MIN_VOUCHER_MINOR && minor <= MAX_VOUCHER_MINOR ? minor : null;
}

/**
 * The last Irish calendar day it can be used: the same date 5 years after the
 * day it was bought. Bought on 29 February → 1 March (never less than 5 years).
 */
export function expiryDay(purchaseDay: string, years = VOUCHER_YEARS) {
  const [y, m, d] = purchaseDay.split("-").map(Number);
  const t = new Date(Date.UTC(y + years, m - 1, d, 12));
  return t.toISOString().slice(0, 10);
}

export const isExpired = (expiresOn: string | null, today: string) => !!expiresOn && today > expiresOn;

export type LedgerEvent = { id: string; kind: EventKind; amountMinor: number; undoOf?: string | null };

/** The balance: issued (+), used (−), undone (+), refunded (−), cancelled (−), adjusted (±). */
export const balanceOf = (events: Pick<LedgerEvent, "amountMinor">[]) => events.reduce((s, e) => s + e.amountMinor, 0);

/**
 * Why `amountMinor` can't be used from this voucher right now, in words for
 * reception, or null when it can. Part use is allowed and what's left stays on
 * the voucher (the Act: no one has to spend it all at once).
 */
export function useRefusal(v: { status: VoucherStatus; expiresOn: string | null; balanceMinor: number }, amountMinor: number, today: string): string | null {
  if (v.status === "pending") return "This voucher hasn't been paid for yet.";
  if (v.status === "cancelled") return "This voucher was cancelled, so it can't be used.";
  if (isExpired(v.expiresOn, today)) return `This voucher expired on ${dayText(v.expiresOn!)}.`;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return "Enter the amount to use, more than €0.";
  if (v.balanceMinor <= 0) return "There's nothing left on this voucher.";
  if (amountMinor > v.balanceMinor) return `Only ${euroText(v.balanceMinor)} is left on this voucher.`;
  return null;
}

/** Whether a "used" line can still be undone (a mistake at the desk): not already undone. */
export function undoRefusal(e: LedgerEvent | undefined, alreadyUndone: boolean): string | null {
  if (!e) return "That line isn't on this voucher.";
  if (e.kind !== "redeemed") return "Only a use of the voucher can be undone.";
  if (alreadyUndone) return "That use has already been undone.";
  return null;
}

/**
 * Stripe refunded `refundedTotalMinor` of the purchase so far; `alreadyMinor` is
 * what the ledger already took off for refunds. The whole new refund goes on the
 * ledger, even past zero (a balance below zero means the buyer got back more than
 * was left, and an undone use can never make that spendable again). `shortMinor`:
 * how much of it had already been used (for the alert).
 */
export function refundToRecord(refundedTotalMinor: number, alreadyMinor: number, balanceMinor: number) {
  const take = Math.max(0, refundedTotalMinor - alreadyMinor);
  return { take, shortMinor: Math.max(0, take - Math.max(0, balanceMinor)) };
}

/**
 * Euro amount typed at the desk ("75", "75.50", "37,50", "1,000", "€75") → cents;
 * null if it isn't clearly a positive amount. A comma before the last one or two
 * digits is a decimal comma; otherwise commas must group thousands.
 */
export function typedEuroToMinor(raw: string): number | null {
  let s = raw.trim().replace(/^€\s*/, "");
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else if (s.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return null;
    s = s.replace(/,/g, "");
  }
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  const minor = Math.round(Number(s) * 100);
  return minor > 0 ? minor : null;
}

// ---- Vaoucher import: one voucher per line, "code, amount left, expiry date[, name]".

export type ImportRow = { code: string; balanceMinor: number; expiresOn: string; name: string };
export type ImportResult = { rows: ImportRow[]; problems: string[] };

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().startsWith(s);

/** "31/12/2027" or "2027-12-31" → "2027-12-31"; null otherwise. */
export function parseDay(raw: string): string | null {
  const s = raw.trim();
  if (isDay(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const day = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isDay(day) ? day : null;
}

export function parseImport(text: string): ImportResult {
  const rows: ImportRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const cells = line.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const n = i + 1;
    if (i === 0 && /code/i.test(cells[0] ?? "")) return; // a header row
    const code = (codeCandidates(cells[0] ?? "") ?? [])[0];
    const balanceMinor = typedEuroToMinor(cells[1] ?? "");
    const expiresOn = parseDay(cells[2] ?? "");
    if (!code) return problems.push(`Line ${n}: no voucher code.`);
    if (balanceMinor == null || balanceMinor > 2000_00) return problems.push(`Line ${n} (${code}): the amount left isn't a euro amount.`);
    if (!expiresOn) return problems.push(`Line ${n} (${code}): the expiry date isn't a date (use 31/12/2027).`);
    if (seen.has(code)) return problems.push(`Line ${n} (${code}): this code is in the list twice.`);
    seen.add(code);
    rows.push({ code, balanceMinor, expiresOn, name: (cells[3] ?? "").slice(0, 120) });
  });
  return { rows, problems };
}

// ---- Words for the email and the PDF.

export type VoucherForWords = {
  code: string;
  amountMinor: number;
  balanceMinor?: number;
  /** Null for vouchers brought over from Vaoucher (bought before the Hub). */
  purchaseDay: string | null;
  expiresOn: string;
  buyerName: string;
  recipientName: string | null;
  message: string | null;
  /** The code can be typed when booking online (v2). */
  bookOnline?: boolean;
  /** Scheduled send (v2): the day the person it's for gets it. */
  sendOn?: string | null;
};

/** How it's used, while patients can't yet type the code when booking online (stage 1). */
export const HOW_TO_USE = `To book, call us on ${CLINIC_PHONE} or email ${CLINIC_EMAIL} and quote the code. Use it towards any treatment at Northbank, in one visit or several. Whatever is left stays on the voucher until it expires.`;
/** Once the code can be typed when booking online (VOUCHER_CHECKOUT=on, v2). */
export const HOW_TO_USE_ONLINE = `Book online at book.northbank.example and type the code when you pay, or call us on ${CLINIC_PHONE}. Use it towards any treatment at Northbank, in one visit or several. Whatever is left stays on the voucher until it expires. Check what's left at book.northbank.example/vouchers/balance.`;
export const howToUse = (bookOnline?: boolean) => (bookOnline ? HOW_TO_USE_ONLINE : HOW_TO_USE);
export const TERMS = "Keep the code safe: anyone who has it can use it. Lost it? We can send it again to the email it was sent to.";

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "";

/**
 * The emails. The buyer always gets one (the written confirmation of the
 * purchase date, expiry date and how long it can be used for, which the Act
 * requires); the person it's for gets their own when the buyer chose that.
 */
export function voucherEmail(
  v: VoucherForWords,
  to: "buyer" | "recipient",
  opts: { sentToRecipient?: string | null; resend?: boolean; scheduledFor?: string | null } = {},
  overrides?: EmailOverrides | null
) {
  const amount = euroText(v.amountMinor);
  const code = displayCode(v.code);
  const facts =
    `Voucher code: ${code}\n` +
    `Value: ${amount}${v.balanceMinor != null && v.balanceMinor !== v.amountMinor ? ` (${euroText(v.balanceMinor)} left)` : ""}\n` +
    (v.purchaseDay ? `Bought: ${dayText(v.purchaseDay)}\n` : "") +
    `Valid until: ${dayText(v.expiresOn)}. It can be used any time from the day it was bought until then.`;
  if (to === "recipient") {
    const mail = fillTemplate(
      "voucher_recipient",
      {
        first_name: firstName(v.recipientName),
        buyer_name: v.buyerName.trim(),
        buyer_first_name: firstName(v.buyerName),
        amount,
        message: v.message,
        voucher_details: facts,
        how_to_use: howToUse(v.bookOnline),
        terms: TERMS,
      },
      overrides
    );
    return { subject: mail.subject, text: mail.text };
  }
  const recipientLine = opts.scheduledFor
    ? `We'll email the voucher to ${v.recipientName?.trim() || "them"} at ${opts.sentToRecipient} on ${dayText(opts.scheduledFor)}, in the morning. A copy is attached for you now.`
    : opts.sentToRecipient
    ? `We've emailed the voucher to ${v.recipientName?.trim() || "them"} at ${opts.sentToRecipient}. A copy is attached for you too.`
    : v.recipientName
      ? `The voucher is attached as a PDF, made out to ${v.recipientName.trim()}, ready to print or forward.`
      : "The voucher is attached as a PDF, ready to print or forward.";
  const mail = fillTemplate(
    opts.resend ? "voucher_resend" : "voucher_buyer",
    { first_name: firstName(v.buyerName), amount, code, delivery: recipientLine, voucher_details: facts, how_to_use: howToUse(v.bookOnline), terms: TERMS },
    overrides
  );
  return { subject: mail.subject, text: mail.text };
}

export const voucherPdfName = (code: string) => `Northbank-gift-voucher-${displayCode(code)}.pdf`;

/** The Stripe line: generic, the amount only (nothing about who it's for). */
export const stripeVoucherLine = (amountMinor: number) => ({ name: `Northbank gift voucher ${euroText(amountMinor)}` });

/**
 * What a voucher of this amount covers, from the clinic's live prices: the
 * dearest treatments it pays for in full, at most `n`, one per name.
 */
export function coversExamples(amountMinor: number, types: { name: string; fullPriceEUR: number | null }[], n = 3) {
  const seen = new Set<string>();
  return types
    .filter((t) => t.fullPriceEUR != null && t.fullPriceEUR > 0 && Math.round(t.fullPriceEUR * 100) <= amountMinor)
    .sort((a, b) => (b.fullPriceEUR as number) - (a.fullPriceEUR as number) || a.name.localeCompare(b.name))
    .filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)))
    .slice(0, n)
    .map((t) => ({ name: t.name, priceMinor: Math.round((t.fullPriceEUR as number) * 100) }));
}

/** Per-therapist totals of vouchers used, for the monthly statement. */
export function totalsByTherapist(uses: { practitionerId: string; practitionerName: string; amountMinor: number }[]) {
  const m = new Map<string, { practitionerId: string; name: string; amountMinor: number; count: number }>();
  for (const u of uses) {
    const row = m.get(u.practitionerId) ?? { practitionerId: u.practitionerId, name: u.practitionerName, amountMinor: 0, count: 0 };
    row.amountMinor += u.amountMinor;
    row.count += u.amountMinor > 0 ? 1 : u.amountMinor < 0 ? -1 : 0;
    m.set(u.practitionerId, row);
  }
  return [...m.values()].filter((r) => r.amountMinor !== 0 || r.count !== 0).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Gift vouchers stopped being sold on 9 Nov 2026: no new vouchers are made, online
 * or at the desk. Existing vouchers can still be used: reception looks the code up
 * on the dashboard and takes it off for the treatment. VOUCHER_SALES no longer
 * switches online sales on.
 */
export const VOUCHER_SALES_CLOSED = true;
export const voucherSalesOn = (_env: Record<string, string | undefined>) => false;

// ---------------------------------------------------------------- v2: using a voucher when booking online

/**
 * Patients can type a voucher code when they pay online, once VOUCHER_CHECKOUT is "on" in
 * Vercel (separate from VOUCHER_SALES, so it can be tried on its own first).
 */
export const voucherCheckoutOn = (env: Record<string, string | undefined>) => (env.VOUCHER_CHECKOUT ?? "").trim().toLowerCase() === "on";

/** Stripe won't take a card payment under 50c. */
export const STRIPE_MIN_MINOR = 50;

/**
 * How much of the voucher goes towards a fee: all of what's available, up to the fee. If
 * that would leave less than Stripe's 50c minimum on the card, the voucher covers 50c less.
 */
export function appliedMinor(feeMinor: number, availableMinor: number) {
  if (!(feeMinor > 0) || !(availableMinor > 0)) return 0;
  let applied = Math.min(availableMinor, feeMinor);
  const rest = feeMinor - applied;
  if (rest > 0 && rest < STRIPE_MIN_MINOR) applied = feeMinor - STRIPE_MIN_MINOR;
  return Math.max(0, applied);
}

/** What can still be spent: the ledger balance less what's set aside for online bookings in progress. */
export const availableOf = (balanceMinor: number, heldMinor: number) => balanceMinor - Math.max(0, heldMinor);

/**
 * Why a voucher can't go towards an online booking right now, in words for the patient, or null.
 * Deliberately says nothing about who bought it or for whom.
 */
export function checkoutRefusal(v: { status: VoucherStatus; expiresOn: string | null; availableMinor: number; balanceMinor: number }, today: string): string | null {
  if (v.status !== "active") return "This voucher can't be used. Please call us if you think that's wrong.";
  if (isExpired(v.expiresOn, today)) return `This voucher expired on ${dayText(v.expiresOn!)}.`;
  if (v.balanceMinor <= 0) return "There's nothing left on this voucher.";
  if (v.availableMinor <= 0) return "This voucher is being used for another booking right now. Try again in half an hour, or call us.";
  return null;
}

/** The voucher on an online booking (BookingRecord.voucher). */
export type BookingVoucher = {
  voucherId: string;
  code: string;
  holdId: string;
  /** The "used" line on the voucher; missing only if marking it used failed (reconcile finishes it). */
  eventId?: string;
  amountMinor: number;
  /** Put back on the voucher (cancelled in time): how much, and the line that did it. */
  returnedMinor?: number;
  returnEventId?: string;
  at: string;
};

/** What the voucher still pays towards the fee (after anything put back). */
export const voucherNetMinor = (v: BookingVoucher | undefined | null) => (v ? Math.max(0, v.amountMinor - (v.returnedMinor ?? 0)) : 0);

/** The latest day a buyer can choose for the voucher to reach the person it's for. */
export const MAX_SEND_AHEAD_DAYS = 90;
/** Scheduled vouchers go out from this Irish hour on the day. */
export const SEND_FROM_HOUR = 8;

/** Whether a chosen send day is allowed (today to 90 days ahead). Today = send now. */
export function sendOnRefusal(sendOn: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sendOn) || Number.isNaN(Date.parse(`${sendOn}T12:00:00Z`))) return "Choose a date to send it.";
  if (sendOn < today) return "Choose today or a day after.";
  const max = new Date(Date.parse(`${today}T12:00:00Z`) + MAX_SEND_AHEAD_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (sendOn > max) return `Choose a day in the next ${MAX_SEND_AHEAD_DAYS} days.`;
  return null;
}

/** Whether a scheduled voucher is due to go to the person it's for, at this Irish day and hour. */
export const sendDue = (sendOn: string | null, today: string, hour: number) => !sendOn || sendOn < today || (sendOn === today && hour >= SEND_FROM_HOUR);
