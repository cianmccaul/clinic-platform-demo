/**
 * Irish date, time and money formats for everything the patient reads:
 * screens, emails and the Stripe Checkout line item. Pure (no I/O), always
 * in Europe/Dublin, unit-tested in tests/format.test.ts.
 *
 *   dayShort   "Tue 13 Oct"
 *   dayLong    "Tuesday 13 October"
 *   timeShort  "10:30am"
 *   whenShort  "Tue 13 Oct, 10:30am"
 *   whenLong   "Tuesday 13 October, 10:30am"
 */

const TZ = "Europe/Dublin";

function parts(iso: string, opts: Intl.DateTimeFormatOptions, timeZone = TZ) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone, ...opts }).formatToParts(new Date(iso))) {
    out[p.type] = p.value;
  }
  return out;
}

export function dayShort(iso: string) {
  const p = parts(iso, { weekday: "short", day: "numeric", month: "short" });
  return `${p.weekday} ${p.day} ${p.month}`;
}

export function dayLong(iso: string) {
  const p = parts(iso, { weekday: "long", day: "numeric", month: "long" });
  return `${p.weekday} ${p.day} ${p.month}`;
}

export function timeShort(iso: string) {
  const p = parts(iso, { hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const h24 = Number(p.hour);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${p.minute}${h24 < 12 ? "am" : "pm"}`;
}

export const whenShort = (iso: string) => `${dayShort(iso)}, ${timeShort(iso)}`;
export const whenLong = (iso: string) => `${dayLong(iso)}, ${timeShort(iso)}`;

/** Hour of the day in Ireland (0–23). */
export function dublinHour(iso: string) {
  return Number(parts(iso, { hour: "numeric", hourCycle: "h23" }).hour);
}

export type DayPart = "Morning" | "Afternoon" | "Evening";
export function dayPart(iso: string): DayPart {
  const h = dublinHour(iso);
  return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
}

// ---- Calendar days ("YYYY-MM-DD", already in Irish time) ----

const noonUTC = (day: string) => `${day}T12:00:00Z`;

/** "Tue" and "13" and "Oct" for a calendar day, for the week strip. */
export function dayLabel(day: string) {
  const p = parts(noonUTC(day), { weekday: "short", day: "numeric", month: "short" }, "UTC");
  return { weekday: p.weekday, date: p.day, month: p.month, full: `${p.weekday} ${p.day} ${p.month}` };
}

/** The Monday of the week that contains `day`. */
export function mondayOf(day: string) {
  const dow = new Date(noonUTC(day)).getUTCDay(); // 0 Sunday … 6 Saturday
  const back = (dow + 6) % 7;
  return new Date(Date.parse(noonUTC(day)) - back * 86_400_000).toISOString().slice(0, 10);
}

// ---- Money ----

/** €20.00 from euro (Cliniko prices are in euro). */
export const eur = (amount: number) => `€${amount.toFixed(2)}`;

// ---- Words shared between the review screen and Stripe Checkout ----

export const CLINIC_ADDRESS = "12 Quay Street, Dublin 2";

/**
 * What Stripe is told an appointment is: never the treatment's name
 * (clinic decision, 15 Oct). Names like "Acupuncture for Fertility" or
 * "Breastfeeding Physiotherapy" say something about a patient's health,
 * and Stripe shows them on Checkout, receipts, card statements and in
 * every dashboard the payment appears in.
 */
export const STRIPE_ITEM_NAME = "Northbank appointment";

/** The Checkout line item: generic name, plus when and where. */
export function stripeLineItem(startsAtISO: string) {
  return { name: STRIPE_ITEM_NAME, description: `${whenShort(startsAtISO)} · Northbank, ${CLINIC_ADDRESS}` };
}

/** "Northbank appointment Tue 13 Oct, 10:30am": for charge descriptions in Stripe. */
export const stripeAppointmentLabel = (startsAtISO: string) => `${STRIPE_ITEM_NAME} ${whenShort(startsAtISO)}`;

/** The treatment line on the Hub's own screens (not sent to Stripe: see stripeLineItem). */
export function checkoutLineItem(appointmentTypeName: string, startsAtISO: string) {
  // Same clean-up the booking screens apply: drop staff ordering like "1. ".
  const name = appointmentTypeName.replace(/^\d+\.\s*/, "").trim();
  return { name, description: `${whenShort(startsAtISO)} · Northbank, ${CLINIC_ADDRESS}` };
}
