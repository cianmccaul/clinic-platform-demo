/**
 * KPI dashboard v2 (Cian's "Clinic KPI Dashboard" report, 20 Oct 2026).
 * Pure: lib/kpi2.ts reads Cliniko and the Hub, this works out every figure.
 * Unit-tested in tests/kpi2.test.ts.
 *
 * Weeks run Monday to Sunday, Irish time. Every card compares the last full
 * week with the clinic's own previous 8 weeks (the report's rule: our own
 * baseline first, outside benchmarks never as targets).
 *
 * - Value of care: each attended appointment at its Cliniko price (the
 *   appointment type's billable items). Stands in for revenue until every
 *   online booking is invoiced in Cliniko.
 * - Available time: each therapist's regular hours in Cliniko (daily
 *   availabilities), plus one-off extra availability, minus unavailable
 *   blocks. A bank holiday with no appointments counts as closed.
 * - Utilisation: booked minutes inside available time ÷ available minutes.
 * - Attendance: attended minutes ÷ booked minutes.
 * - North Star: value of care ÷ available hours
 *   = fee per attended hour × utilisation × attendance.
 * - Rebooked: an attended appointment whose patient's next appointment was
 *   booked by 48 hours after it ended.
 * - Missed: did not arrive + cancelled less than 24 hours ahead, out of the
 *   appointments that were due to happen.
 * - New patient: attended a "New patient" appointment type in the week.
 * - Active patient: attended in the last 90 days (180 for massage and
 *   acupuncture, which are often maintenance).
 */
import { CANCEL_WINDOW_HOURS } from "./policy.ts";
import { irishBankHolidays } from "./tasks.ts";

export const BASELINE_WEEKS = 8;
export const TREND_WEEKS = 13;
export const REBOOK_HOURS = 48;
export const ACTIVE_DAYS = 90;
export const ACTIVE_DAYS_MAINTENANCE = 180;
/** Below this many events a rate is shown as a count, with "not enough data yet". */
export const MIN_EVENTS = 10;
/** From this many events the card says the figure is reliable. */
export const GOOD_EVENTS = 30;
export const HEAT_FROM_HOUR = 7;
export const HEAT_TO_HOUR = 21; // exclusive

export const MODALITIES = ["physio", "massage", "osteopathy", "acupuncture", "other"] as const;
export type Modality = (typeof MODALITIES)[number];
export const MODALITY_LABEL: Record<Modality, string> = {
  physio: "Physiotherapy",
  massage: "Massage",
  osteopathy: "Osteopathy",
  acupuncture: "Acupuncture",
  other: "Other",
};

/** Cliniko category (and type name) → treatment type. Women's health and scoliosis are physio. */
export function modalityOf(category: string | null | undefined, typeName = ""): Modality {
  const c = `${(category ?? "").replace(/^\d+\.\s*/, "")} ${typeName}`.toLowerCase();
  if (/massage|reflexology|lymphatic/.test(c)) return "massage";
  if (/osteopath|craniosacral/.test(c)) return "osteopathy";
  if (/acupuncture|herbal|reiki/.test(c)) return "acupuncture";
  if (/physio|shockwave|laser|scoliosis|women'?s health|natal|breastfeeding|running|needling/.test(c)) return "physio";
  return "other";
}

export const isNewPatientType = (typeName: string) => /\bnew\s+patient\b/i.test(typeName);

// ---------- inputs ----------

export type Appt = {
  id: string;
  patientId: string;
  practitionerId: string;
  typeName: string;
  modality: Modality;
  startsAt: string; // ISO
  endsAt: string;
  createdAt: string;
  cancelledAt: string | null;
  didNotArrive: boolean;
  priceMinor: number | null;
};
/** Regular hours: Cliniko's day_of_week as given, ranges in minutes after midnight (Irish time). */
export type Availability = { practitionerId: string; dayOfWeek: number; ranges: [number, number][] };
export type Block = { practitionerId: string; startsAt: string; endsAt: string };

export type KpiInput = {
  nowMs: number;
  appts: Appt[];
  availabilities: Availability[];
  unavailable: Block[];
  extra: Block[];
  /** Late-cancel and no-show fees taken through the Hub, by Irish day. */
  feesMinorByDay?: Record<string, number>;
  targetMinor?: number | null;
  /** Value of care for the whole of last month, for the default target. */
};

// ---------- Irish time ----------

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const partsCache = new Map<number, { day: string; minute: number }>();
export function dublin(ms: number): { day: string; minute: number } {
  const hit = partsCache.get(ms);
  if (hit) return hit;
  const p = PARTS.formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const v = { day: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) };
  if (partsCache.size > 50_000) partsCache.clear();
  partsCache.set(ms, v);
  return v;
}
const noon = (day: string) => Date.parse(`${day}T12:00:00Z`);
export const addDays = (day: string, n: number) => new Date(noon(day) + n * 86_400_000).toISOString().slice(0, 10);
export const weekdayOf = (day: string) => (new Date(noon(day)).getUTCDay() + 6) % 7; // 0 = Monday
export const mondayOf = (day: string) => addDays(day, -weekdayOf(day));

/** UTC ms of Irish midnight starting `day` (DST-aware). */
export function midnight(day: string): number {
  const base = Date.parse(`${day}T00:00:00Z`);
  for (const off of [1, 0]) {
    const t = base - off * 3_600_000;
    if (dublin(t).day === day && dublin(t - 1).day !== day) return t;
  }
  return base;
}

type Iv = [number, number]; // ms
function merge(ivs: Iv[]): Iv[] {
  const s = ivs.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Iv[] = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}
function subtract(base: Iv[], cut: Iv[]): Iv[] {
  let out = base;
  for (const [c0, c1] of cut) {
    const next: Iv[] = [];
    for (const [a, b] of out) {
      if (c1 <= a || c0 >= b) next.push([a, b]);
      else {
        if (c0 > a) next.push([a, c0]);
        if (c1 < b) next.push([c1, b]);
      }
    }
    out = next;
  }
  return out;
}
const overlap = (ivs: Iv[], a: number, b: number) => ivs.reduce((s, [x, y]) => s + Math.max(0, Math.min(y, b) - Math.max(x, a)), 0);

// ---------- availability ----------

/**
 * Cliniko's day_of_week numbering isn't documented (0 could be Sunday or
 * Monday). Pick the reading under which most past appointments fall inside
 * working hours.
 */
export function detectSundayZero(av: Availability[], appts: Appt[]): boolean {
  const score = (sundayZero: boolean) => {
    let n = 0;
    for (const a of appts.slice(0, 3000)) {
      if (a.cancelledAt) continue;
      const s = dublin(Date.parse(a.startsAt));
      const wd = weekdayOf(s.day); // 0 = Monday
      const cl = sundayZero ? (wd + 1) % 7 : wd;
      if (av.some((x) => x.practitionerId === a.practitionerId && x.dayOfWeek === cl && x.ranges.some(([r0, r1]) => s.minute >= r0 && s.minute < r1))) n++;
    }
    return n;
  };
  return score(true) >= score(false);
}

export type AvailabilityIndex = (practitionerId: string, day: string) => Iv[];

export function buildAvailability(input: Pick<KpiInput, "availabilities" | "unavailable" | "extra" | "appts">): { at: AvailabilityIndex; practitioners: Set<string> } {
  const sundayZero = detectSundayZero(input.availabilities, input.appts);
  const byPracDow = new Map<string, [number, number][]>();
  for (const a of input.availabilities) {
    const k = `${a.practitionerId}|${a.dayOfWeek}`;
    byPracDow.set(k, [...(byPracDow.get(k) ?? []), ...a.ranges]);
  }
  const practitioners = new Set(input.availabilities.filter((a) => a.ranges.length).map((a) => a.practitionerId));
  const blocks = (list: Block[]) => {
    const m = new Map<string, Iv[]>();
    for (const b of list) m.set(b.practitionerId, [...(m.get(b.practitionerId) ?? []), [Date.parse(b.startsAt), Date.parse(b.endsAt)]]);
    return m;
  };
  const off = blocks(input.unavailable);
  const extra = blocks(input.extra);
  for (const p of extra.keys()) practitioners.add(p);
  const busyDays = new Set(input.appts.filter((a) => !a.cancelledAt).map((a) => `${a.practitionerId}|${dublin(Date.parse(a.startsAt)).day}`));
  const holidays = new Map<number, Set<string>>();
  const isHoliday = (day: string) => {
    const y = Number(day.slice(0, 4));
    if (!holidays.has(y)) holidays.set(y, irishBankHolidays(y));
    return holidays.get(y)!.has(day);
  };
  const cache = new Map<string, Iv[]>();
  const at: AvailabilityIndex = (pid, day) => {
    const key = `${pid}|${day}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const wd = weekdayOf(day);
    const dow = sundayZero ? (wd + 1) % 7 : wd;
    const m0 = midnight(day);
    const m1 = midnight(addDays(day, 1));
    let ivs: Iv[] = (byPracDow.get(`${pid}|${dow}`) ?? []).map(([a, b]) => [m0 + a * 60_000, m0 + b * 60_000]);
    if (isHoliday(day) && !busyDays.has(key)) ivs = [];
    ivs = merge([...ivs, ...(extra.get(pid) ?? []).map(([a, b]) => [Math.max(a, m0), Math.min(b, m1)] as Iv)]);
    ivs = subtract(ivs, off.get(pid) ?? []);
    cache.set(key, ivs);
    return ivs;
  };
  return { at, practitioners };
}

// ---------- weekly figures ----------

export type WeekStats = {
  week: string; // Monday
  complete: boolean;
  availableMin: number;
  bookedMin: number; // non-cancelled, inside available time
  attendedMin: number;
  due: number; // appointments that were due to happen: not cancelled, or cancelled late
  booked: number; // not cancelled
  attended: number;
  noShows: number;
  lateCancels: number;
  cancels: number;
  rebooked: number; // of attended
  valueMinor: number;
  missedValueMinor: number;
  feesMinor: number;
  newPatients: number;
  activePatients: number;
};

const emptyWeek = (week: string, complete: boolean): WeekStats => ({
  week,
  complete,
  availableMin: 0,
  bookedMin: 0,
  attendedMin: 0,
  due: 0,
  booked: 0,
  attended: 0,
  noShows: 0,
  lateCancels: 0,
  cancels: 0,
  rebooked: 0,
  valueMinor: 0,
  missedValueMinor: 0,
  feesMinor: 0,
  newPatients: 0,
  activePatients: 0,
});

export type Scope = { kind: "clinic" } | { kind: "modality"; modality: Modality } | { kind: "practitioner"; id: string };
const inScope = (a: Appt, s: Scope) => (s.kind === "clinic" ? true : s.kind === "modality" ? a.modality === s.modality : a.practitionerId === s.id);

const isLate = (a: Appt) => !!a.cancelledAt && Date.parse(a.startsAt) - Date.parse(a.cancelledAt) < CANCEL_WINDOW_HOURS * 3_600_000;

/** Per patient: their appointments (not cancelled) by start, for rebooking and activity. */
function patientIndex(appts: Appt[]) {
  const m = new Map<string, Appt[]>();
  for (const a of appts) if (!a.cancelledAt) (m.get(a.patientId) ?? m.set(a.patientId, []).get(a.patientId))!.push(a);
  for (const list of m.values()) list.sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
  return m;
}

export function weekStats(input: KpiInput, monday: string, scope: Scope, av: ReturnType<typeof buildAvailability>, byPatient = patientIndex(input.appts)): WeekStats {
  const nowMs = input.nowMs;
  const w0 = midnight(monday);
  const w1 = midnight(addDays(monday, 7));
  const s = emptyWeek(monday, w1 <= nowMs);
  const upTo = Math.min(w1, nowMs); // the current week: only up to now

  // Available time.
  const pracs = scope.kind === "practitioner" ? [scope.id] : [...av.practitioners];
  if (scope.kind !== "modality") {
    for (let d = 0; d < 7; d++) {
      const day = addDays(monday, d);
      for (const p of pracs) for (const [a, b] of av.at(p, day)) s.availableMin += Math.max(0, Math.min(b, upTo) - a) / 60_000;
    }
  }

  const newSet = new Set<string>();
  for (const a of input.appts) {
    if (!inScope(a, scope)) continue;
    const t0 = Date.parse(a.startsAt);
    if (t0 < w0 || t0 >= w1 || t0 > nowMs) continue;
    const t1 = Date.parse(a.endsAt);
    const price = a.priceMinor ?? 0;
    if (a.cancelledAt) {
      s.cancels++;
      if (isLate(a)) {
        s.lateCancels++;
        s.due++;
        s.missedValueMinor += price;
      }
      continue;
    }
    s.booked++;
    s.due++;
    if (scope.kind !== "modality" && av.practitioners.has(a.practitionerId)) {
      s.bookedMin += overlap(av.at(a.practitionerId, dublin(t0).day), t0, t1) / 60_000;
    }
    if (a.didNotArrive) {
      s.noShows++;
      s.missedValueMinor += price;
      continue;
    }
    s.attended++;
    if (scope.kind !== "modality" && av.practitioners.has(a.practitionerId)) s.attendedMin += overlap(av.at(a.practitionerId, dublin(t0).day), t0, t1) / 60_000;
    s.valueMinor += price;
    if (isNewPatientType(a.typeName)) newSet.add(a.patientId);
    // Rebooked: their next appointment was made by 48 h after this one ended.
    const next = (byPatient.get(a.patientId) ?? []).find((x) => Date.parse(x.startsAt) > t0 && x.id !== a.id);
    if (next && Date.parse(next.createdAt) <= t1 + REBOOK_HOURS * 3_600_000) s.rebooked++;
  }
  s.newPatients = newSet.size;
  if (input.feesMinorByDay && scope.kind === "clinic") for (let d = 0; d < 7; d++) s.feesMinor += input.feesMinorByDay[addDays(monday, d)] ?? 0;
  s.activePatients = activeAt(input.appts, Math.min(w1, nowMs), scope).size;
  return s;
}

/** Patients with an attended appointment in the 90 days (180 for maintenance treatments) before `atMs`. */
export function activeAt(appts: Appt[], atMs: number, scope: Scope = { kind: "clinic" }): Set<string> {
  const out = new Set<string>();
  for (const a of appts) {
    if (a.cancelledAt || a.didNotArrive || !inScope(a, scope)) continue;
    const t = Date.parse(a.startsAt);
    if (t > atMs) continue;
    const days = a.modality === "massage" || a.modality === "acupuncture" ? ACTIVE_DAYS_MAINTENANCE : ACTIVE_DAYS;
    if (t >= atMs - days * 86_400_000) out.add(a.patientId);
  }
  return out;
}

// ---------- derived ----------

export const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
export const utilisation = (s: WeekStats) => ratio(s.bookedMin, s.availableMin);
export const attendance = (s: WeekStats) => ratio(s.attendedMin, s.bookedMin);
export const northStar = (s: WeekStats) => (s.availableMin > 0 ? s.valueMinor / (s.availableMin / 60) : null);
export const feePerAttendedHour = (s: WeekStats) => (s.attendedMin > 0 ? s.valueMinor / (s.attendedMin / 60) : null);
export const rebookRate = (s: WeekStats) => ratio(s.rebooked, s.attended);
export const missedRate = (s: WeekStats) => ratio(s.noShows + s.lateCancels, s.due);
export const avgFee = (s: WeekStats) => (s.attended > 0 ? s.valueMinor / s.attended : null);

export type Baseline = { mean: number; sd: number; n: number } | null;
export function baseline(values: (number | null)[]): Baseline {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length < 3) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
  return { mean, sd, n: v.length };
}
/** "up", "down" or "normal" (within 2 standard deviations, or under ~5% of the usual). */
export function movement(value: number | null, b: Baseline): "up" | "down" | "normal" | "unknown" {
  if (value == null || !b) return "unknown";
  const band = Math.max(2 * b.sd, Math.abs(b.mean) * 0.05);
  if (value > b.mean + band) return "up";
  if (value < b.mean - band) return "down";
  return "normal";
}
export function confidence(events: number): "good" | "low" | "none" {
  if (events >= GOOD_EVENTS) return "good";
  if (events >= MIN_EVENTS) return "low";
  return "none";
}

// ---------- forward capacity and busy times ----------

export type DayGap = { day: string; availableMin: number; bookedMin: number };
export function forwardGaps(input: KpiInput, av: ReturnType<typeof buildAvailability>, days: number): DayGap[] {
  const today = dublin(input.nowMs).day;
  const out: DayGap[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const from = i === 0 ? input.nowMs : midnight(day);
    let availableMin = 0;
    let bookedMin = 0;
    for (const p of av.practitioners) {
      const ivs = av.at(p, day);
      availableMin += ivs.reduce((s, [a, b]) => s + Math.max(0, b - Math.max(a, from)), 0) / 60_000;
      for (const a of input.appts) {
        if (a.cancelledAt || a.practitionerId !== p) continue;
        const t0 = Date.parse(a.startsAt);
        if (dublin(t0).day !== day) continue;
        bookedMin += overlap(ivs, Math.max(t0, from), Date.parse(a.endsAt)) / 60_000;
      }
    }
    out.push({ day, availableMin, bookedMin: Math.min(bookedMin, availableMin) });
  }
  return out;
}

/** % full by weekday (0 = Mon) × hour over the given weeks: booked ÷ available minutes. */
export function heatmap(input: KpiInput, av: ReturnType<typeof buildAvailability>, mondays: string[]) {
  const avail = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const booked = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const days = new Set<string>();
  for (const m of mondays) for (let d = 0; d < 7; d++) days.add(addDays(m, d));
  for (const day of days) {
    const wd = weekdayOf(day);
    const m0 = midnight(day);
    for (const p of av.practitioners) {
      const ivs = av.at(p, day);
      if (!ivs.length) continue;
      for (let h = HEAT_FROM_HOUR; h < HEAT_TO_HOUR; h++) avail[wd][h] += overlap(ivs, m0 + h * 3_600_000, m0 + (h + 1) * 3_600_000) / 60_000;
    }
  }
  for (const a of input.appts) {
    if (a.cancelledAt || !av.practitioners.has(a.practitionerId)) continue;
    const t0 = Date.parse(a.startsAt);
    const { day } = dublin(t0);
    if (!days.has(day) || t0 > input.nowMs) continue;
    const ivs = av.at(a.practitionerId, day);
    const wd = weekdayOf(day);
    const m0 = midnight(day);
    for (let h = HEAT_FROM_HOUR; h < HEAT_TO_HOUR; h++) {
      const a0 = Math.max(t0, m0 + h * 3_600_000);
      const a1 = Math.min(Date.parse(a.endsAt), m0 + (h + 1) * 3_600_000);
      if (a1 > a0) booked[wd][h] += overlap(ivs, a0, a1) / 60_000;
    }
  }
  return { avail, booked };
}

const DAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PART = (h: number) => (h < 12 ? "morning" : h < 17 ? "afternoon" : "evening");
/** The busiest and quietest day-parts (morning/afternoon/evening), with enough time to matter. */
export function dayParts(h: { avail: number[][]; booked: number[][] }) {
  const parts: { label: string; availMin: number; bookedMin: number; full: number }[] = [];
  for (let wd = 0; wd < 7; wd++) {
    for (const part of ["morning", "afternoon", "evening"]) {
      let a = 0;
      let b = 0;
      for (let hr = HEAT_FROM_HOUR; hr < HEAT_TO_HOUR; hr++) {
        if (PART(hr) !== part) continue;
        a += h.avail[wd][hr];
        b += h.booked[wd][hr];
      }
      if (a >= 120) parts.push({ label: `${DAY_NAME[wd]} ${part}s`, availMin: a, bookedMin: b, full: b / a });
    }
  }
  parts.sort((x, y) => y.full - x.full);
  return parts;
}

// ---------- money and people in words ----------

export const euros = (minor: number) => `€${Math.round(minor / 100).toLocaleString("en-IE")}`;
export const roughEuros = (minor: number) => {
  const e = Math.abs(minor) / 100;
  const r = e >= 1000 ? Math.round(e / 100) * 100 : e >= 100 ? Math.round(e / 10) * 10 : Math.round(e);
  return `€${r.toLocaleString("en-IE")}`;
};
export const pctText = (r: number | null) => (r == null ? "–" : `${Math.round(r * 100)}%`);
export const hoursText = (min: number) => {
  const h = Math.round(min / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
};

/** Working days (Mon–Fri, not bank holidays) from `day` to the month's end, both included. */
export function workingDaysLeftInMonth(day: string): number {
  let n = 0;
  const month = day.slice(0, 7);
  const hol = irishBankHolidays(Number(day.slice(0, 4)));
  for (let d = day; d.slice(0, 7) === month; d = addDays(d, 1)) if (weekdayOf(d) < 5 && !hol.has(d)) n++;
  return n;
}
