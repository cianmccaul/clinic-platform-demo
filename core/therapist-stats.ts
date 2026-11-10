/**
 * Therapist stats (Cian, 27 Oct 2026): each therapist's month in the numbers the
 * room-rentals tool (PulsePay) works from, read straight from Cliniko instead of
 * a Jane CSV. Owners and super admins only (kpis:view). Stats only: no rent
 * amounts; the invoice itself stays in the room-rentals tool.
 *
 * Same rules as that tool (room-rentals/index.html, calculate() and
 * updateCapacityUI()):
 * - A session is an invoice with an amount billed (its total, paid or not).
 *   Late-cancel and no-show fees count once anything was billed, like any session.
 *   EUR 0 invoices aren't sessions (Cliniko has no "No charge" status to tell a
 *   free session from a waived fee); they're counted separately so owners see them.
 * - Billed is split by the invoice's day: weekday, Saturday, Sunday, bank holiday.
 *   (The tool itself only splits out bank holidays for hybrid therapists, on the
 *   dates they list; everyone else's count as weekdays.)
 * - Capacity = sessions / the therapist's max patients for the month.
 * - Tiers: reaching a tier's upper limit moves you into the next one
 *   (69.9% stays in 50-70, 70.0% is in 70-80); the last tier has no upper limit.
 * - Shockwave / laser: sessions with an item named like that.
 *
 * Differences, because Cliniko isn't Jane: a credit note takes its amount off
 * the invoice it reverses, and a fully reversed invoice isn't a session. Only
 * the clinic's own Cliniko business counts (Room Rentals is a separate one).
 *
 * Periods run from the 29th to the 28th (Cian, 27 Oct 2026, as on the statements).
 *
 * Pure, no I/O; tested in tests/therapist-stats.test.ts.
 */
import { irishBankHolidays } from "./tasks.ts";

export type Tier = { min: number; max: number; pct: number }; // min/max in % of capacity, pct as a fraction (0.45 = 45%)
export type RentModel = "capacity" | "hybrid" | "fixed";
export type TherapistRules = {
  /** Most sessions a month they could see; null if not worked out yet. */
  maxPatients: number | null;
  /** How they pay rent: capacity tiers (and hybrid) use capacity; a fixed amount doesn't. */
  model: RentModel;
  /** Their own tiers; empty means the clinic's default tiers. */
  tiers: Tier[];
  updatedAt?: string;
  updatedBy?: string;
};

/** The room-rentals tool's default tiers. */
export const DEFAULT_TIERS: Tier[] = [
  { min: 0, max: 50, pct: 0.5 },
  { min: 50, max: 70, pct: 0.475 },
  { min: 70, max: 80, pct: 0.45 },
  { min: 80, max: 90, pct: 0.425 },
  { min: 90, max: 100, pct: 0.4 },
];
export const DEFAULT_RULES: TherapistRules = { maxPatients: null, model: "capacity", tiers: [] };

export const usesCapacity = (r: Pick<TherapistRules, "model">) => r.model !== "fixed";
export const tiersOf = (r: Pick<TherapistRules, "tiers">) => (r.tiers?.length ? [...r.tiers].sort((a, b) => a.min - b.min) : DEFAULT_TIERS);

// ---- Cliniko invoices ----

export type InvoiceIn = {
  id: string;
  practitionerId: string | null;
  businessId: string | null;
  issueDay: string; // YYYY-MM-DD (Irish)
  totalMinor: number; // can be negative for a credit note
  status: number | null; // 10 open, 20 paid, 30 closed, 40 open credit
  originalInvoiceId: string | null; // set on a credit note
  deleted: boolean;
  itemNames: string[];
};

export type DayKind = "weekday" | "saturday" | "sunday" | "bankHoliday";
export const DAY_KINDS: DayKind[] = ["weekday", "saturday", "sunday", "bankHoliday"];

const holidayCache = new Map<number, Set<string>>();
export function dayKind(day: string): DayKind {
  const y = Number(day.slice(0, 4));
  if (!holidayCache.has(y)) holidayCache.set(y, irishBankHolidays(y));
  if (holidayCache.get(y)!.has(day)) return "bankHoliday";
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  return wd === 6 ? "saturday" : wd === 0 ? "sunday" : "weekday";
}

/** A credit note reverses an invoice (negative, or pointing at its original). Status 40 alone can be an overpaid invoice. */
const isCredit = (i: InvoiceIn) => i.totalMinor < 0 || !!i.originalInvoiceId;

export type TherapistMonth = {
  practitionerId: string;
  sessions: number;
  /** EUR 0 invoices: not sessions, shown so owners can check them. */
  zeroInvoices: number;
  billedMinor: number;
  byDay: Record<DayKind, { sessions: number; billedMinor: number }>;
  shockwave: number;
  laser: number;
};

const emptyMonth = (practitionerId: string): TherapistMonth => ({
  practitionerId,
  sessions: 0,
  zeroInvoices: 0,
  billedMinor: 0,
  byDay: { weekday: { sessions: 0, billedMinor: 0 }, saturday: { sessions: 0, billedMinor: 0 }, sunday: { sessions: 0, billedMinor: 0 }, bankHoliday: { sessions: 0, billedMinor: 0 } },
  shockwave: 0,
  laser: 0,
});

/**
 * One month's sessions per therapist, from invoices issued in the month (fromDay..toDay)
 * plus any credit notes in `invoices` (issued then or later) that reverse them.
 */
export function monthByTherapist(invoices: InvoiceIn[], o: { fromDay: string; toDay: string; businessId: string }) {
  const live = invoices.filter((i) => !i.deleted && (!i.businessId || i.businessId === o.businessId));
  const credited = new Map<string, number>();
  for (const c of live) if (isCredit(c) && c.originalInvoiceId) credited.set(c.originalInvoiceId, (credited.get(c.originalInvoiceId) ?? 0) + Math.abs(c.totalMinor));
  const out = new Map<string, TherapistMonth>();
  for (const i of live) {
    if (isCredit(i) || !i.practitionerId || i.issueDay < o.fromDay || i.issueDay > o.toDay) continue;
    const billed = i.totalMinor - (credited.get(i.id) ?? 0);
    const m = out.get(i.practitionerId) ?? emptyMonth(i.practitionerId);
    out.set(i.practitionerId, m);
    if (i.totalMinor === 0) {
      m.zeroInvoices++;
      continue;
    }
    if (billed <= 0) continue; // fully reversed
    const k = dayKind(i.issueDay);
    m.sessions++;
    m.billedMinor += billed;
    m.byDay[k].sessions++;
    m.byDay[k].billedMinor += billed;
    if (i.itemNames.some((n) => /shock\s*wave/i.test(n))) m.shockwave++;
    if (i.itemNames.some((n) => /laser/i.test(n))) m.laser++;
  }
  return out;
}

// ---- Capacity ----

export type CapacityView = {
  pct: number; // 0-100+, one decimal
  tierIndex: number; // 0-based
  tier: Tier;
  /** Sessions still needed to reach the next tier, or null at the top. */
  toNextTier: number | null;
};

/** Which tier a capacity % is in: upper limit exclusive, last tier open-ended. */
export function tierIndexFor(pct: number, tiers: Tier[]) {
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (pct >= t.min && (i === tiers.length - 1 || pct < t.max)) return i;
  }
  return pct < (tiers[0]?.min ?? 0) ? 0 : tiers.length - 1;
}

export function capacityFor(sessions: number, rules: TherapistRules): CapacityView | null {
  if (!usesCapacity(rules) || !rules.maxPatients || rules.maxPatients <= 0) return null;
  const tiers = tiersOf(rules);
  const pct = Math.round((sessions / rules.maxPatients) * 1000) / 10;
  const tierIndex = tierIndexFor(pct, tiers);
  const next = tiers[tierIndex + 1];
  let toNextTier: number | null = null;
  if (next) {
    // Smallest whole number of sessions whose rounded % reaches the next tier's minimum.
    let n = Math.max(sessions + 1, Math.ceil(((next.min - 0.05) / 100) * rules.maxPatients));
    while (Math.round((n / rules.maxPatients) * 1000) / 10 < next.min) n++;
    toNextTier = n - sessions;
  }
  return { pct, tierIndex, tier: tiers[tierIndex], toNextTier };
}

/**
 * A rough month-end figure for the current month: sessions so far, scaled by working
 * days (Mon-Sat, not bank holidays) gone versus in the whole month. Null for past
 * months or before 3 working days have gone.
 */
export function paceFor(sessions: number, o: { fromDay: string; toDay: string; today: string }) {
  if (o.today > o.toDay || o.today < o.fromDay) return null;
  let gone = 0;
  let all = 0;
  for (let d = o.fromDay; d <= o.toDay; d = nextDay(d)) {
    const k = dayKind(d);
    if (k === "sunday" || k === "bankHoliday") continue;
    all++;
    if (d < o.today) gone++;
  }
  if (gone < 3 || !all) return null;
  return Math.round((sessions / gone) * all);
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The clinic's rent period (room-rentals tool, computeInvoicePeriod): the 29th of the
 * month before to the 28th of the named month. "2026-10" is 29 Sep to 28 Oct 2026.
 */
export function periodRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 15)).toISOString().slice(0, 7);
  const prevDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  // February without a 29th: the March period starts on 1 March.
  return { fromDay: prevDays >= 29 ? `${prev}-29` : `${month}-01`, toDay: `${month}-28` };
}

/** The period a day falls in: from the 29th on, it's next month's. */
export function periodMonthFor(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return d >= 29 ? new Date(Date.UTC(y, m, 15)).toISOString().slice(0, 7) : day.slice(0, 7);
}

/** The room-rentals tool's capacity calculator: (hours - breaks) / appointment length, rounded down. */
export function maxPatientsFromHours(o: { monthlyHours: number; breaks30?: number; breaks45?: number; breaks60?: number; appointmentMinutes: number }) {
  if (!(o.monthlyHours > 0) || !(o.appointmentMinutes > 0)) return null;
  const breaks = (o.breaks30 ?? 0) * 0.5 + (o.breaks45 ?? 0) * 0.75 + (o.breaks60 ?? 0) * 1;
  return Math.floor(Math.max(0, o.monthlyHours - breaks) / (o.appointmentMinutes / 60));
}

// ---- Rules: checking ----

/** Tiers in order, each 0-100 (last may stop at 100), pct 0-1, no gaps or overlaps. Null if fine. */
export function tierProblem(tiers: Tier[]): string | null {
  if (!tiers.length) return null;
  const s = [...tiers].sort((a, b) => a.min - b.min);
  if (s[0].min !== 0) return "The first tier must start at 0%.";
  for (let i = 0; i < s.length; i++) {
    const t = s[i];
    if (!(t.max > t.min)) return `Tier ${i + 1}: the top must be above the bottom.`;
    if (t.pct < 0 || t.pct > 1) return `Tier ${i + 1}: the rate must be between 0% and 100%.`;
    if (i > 0 && t.min !== s[i - 1].max) return `Tier ${i + 1} must start where tier ${i} ends (${s[i - 1].max}%).`;
  }
  return null;
}
