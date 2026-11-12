/**
 * Practitioner scorecard: each therapist's calendar month, in the measures
 * clinics commonly use to review a practitioner's diary and caseload
 * (utilisation, rebooking, missed appointments, new patients, visits per
 * patient, fee per visit), compared with their own previous three months
 * and with common published ranges. For one-to-one check-ins, not a league
 * table. Pure: give it the appointments and the working hours.
 */
import type { Appt } from "@/core/kpi2";
import { addDays } from "@/core/policy";

export type Hours = Record<string, Partial<Record<number, [string, string]>>>;

export type Measures = {
  visits: number;
  bookedHours: number;
  availableHours: number;
  /** Booked time ÷ working time. */
  howFull: number | null;
  /** Attended visits that left with their next visit already booked (within 48 hours). */
  rebooked: number | null;
  /** No-shows and cancellations inside 24 hours ÷ appointments that were due. */
  missed: number | null;
  newPatients: number;
  /** Attended visits ÷ different patients, over the 90 days to the end of the month. */
  visitsPerPatient: number | null;
  /** Fees for attended visits. */
  valueMinor: number;
  feePerVisitMinor: number | null;
  perAvailableHourMinor: number | null;
};

export type ScoreRow = { practitionerId: string; name: string; month: Measures; usual: Measures; prompts: string[] };
export type Scorecard = { month: string; fromDay: string; toDay: string; soFar: boolean; computedAt: string; rows: ScoreRow[] };

/** Common ranges from published practice-management guidance, shown beside each therapist's own figures. */
export const RANGES = {
  howFull: { low: 0.75, high: 0.85 },
  missed: { high: 0.1 },
};

const HOUR = 3_600_000;
// One formatter, and each timestamp's Irish day worked out once: building an
// Intl.DateTimeFormat per call made a month's scorecard take seconds.
const DUBLIN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" });
const dayCache = new Map<string, string>();
const day = (iso: string) => {
  let d = dayCache.get(iso);
  if (d === undefined) {
    d = DUBLIN_DAY.format(new Date(iso));
    if (dayCache.size > 50_000) dayCache.clear();
    dayCache.set(iso, d);
  }
  return d;
};
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
const monthStart = (m: string) => `${m}-01`;
const monthEnd = (m: string) => addDays(`${new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 15)).toISOString().slice(0, 7)}-01`, -1);
export const shiftMonth = (m: string, n: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 15)).toISOString().slice(0, 7);

function measures(appts: Appt[], hours: Partial<Record<number, [string, string]>>, fromDay: string, toDay: string, nowMs: number): Measures {
  let availableMin = 0;
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) {
    const h = hours[weekday(d)];
    if (h) availableMin += minutesOf(h[1]) - minutesOf(h[0]);
  }
  const inRange = appts.filter((a) => {
    const d = day(a.startsAt);
    return d >= fromDay && d <= toDay && Date.parse(a.startsAt) < nowMs;
  });
  const lateCancel = (a: Appt) => !!a.cancelledAt && Date.parse(a.startsAt) - Date.parse(a.cancelledAt) < 24 * HOUR;
  const held = inRange.filter((a) => !a.cancelledAt);
  const attended = held.filter((a) => !a.didNotArrive);
  const due = held.length + inRange.filter(lateCancel).length;
  const missed = held.filter((a) => a.didNotArrive).length + inRange.filter(lateCancel).length;
  const bookedMin = held.reduce((s, a) => s + (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60_000, 0);
  // Left with the next visit booked: another appointment with them, made by 48 hours after this one ended.
  const byPatient = new Map<string, Appt[]>();
  for (const a of appts) {
    if (a.cancelledAt) continue;
    const list = byPatient.get(a.patientId);
    if (list) list.push(a);
    else byPatient.set(a.patientId, [a]);
  }
  const rebooked = attended.filter((a) =>
    (byPatient.get(a.patientId) ?? []).some((b) => b.startsAt > a.startsAt && Date.parse(b.createdAt) <= Date.parse(a.endsAt) + 48 * HOUR),
  ).length;
  const ninety = addDays(toDay, -89);
  const recent = appts.filter((a) => !a.cancelledAt && !a.didNotArrive && Date.parse(a.startsAt) < nowMs && day(a.startsAt) >= ninety && day(a.startsAt) <= toDay);
  const valueMinor = attended.reduce((s, a) => s + (a.priceMinor ?? 0), 0);
  return {
    visits: attended.length,
    bookedHours: Math.round(bookedMin / 6) / 10,
    availableHours: Math.round(availableMin / 6) / 10,
    howFull: ratio(bookedMin, availableMin),
    rebooked: ratio(rebooked, attended.length),
    missed: ratio(missed, due),
    newPatients: attended.filter((a) => /\bnew\s+patient\b/i.test(a.typeName)).length,
    visitsPerPatient: recent.length ? Math.round((recent.length / new Set(recent.map((a) => a.patientId)).size) * 10) / 10 : null,
    valueMinor,
    feePerVisitMinor: attended.length ? Math.round(valueMinor / attended.length) : null,
    perAvailableHourMinor: availableMin ? Math.round(valueMinor / (availableMin / 60)) : null,
  };
}

/** The average of the three months before, each counted whole. */
function usualOf(ms: Measures[]): Measures {
  const avg = (f: (m: Measures) => number | null) => {
    const v = ms.map(f).filter((x): x is number => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const round = (n: number | null, dp = 0) => (n == null ? null : Math.round(n * 10 ** dp) / 10 ** dp);
  return {
    visits: Math.round(avg((m) => m.visits) ?? 0),
    bookedHours: round(avg((m) => m.bookedHours), 1) ?? 0,
    availableHours: round(avg((m) => m.availableHours), 1) ?? 0,
    howFull: avg((m) => m.howFull),
    rebooked: avg((m) => m.rebooked),
    missed: avg((m) => m.missed),
    newPatients: Math.round(avg((m) => m.newPatients) ?? 0),
    visitsPerPatient: round(avg((m) => m.visitsPerPatient), 1),
    valueMinor: Math.round(avg((m) => m.valueMinor) ?? 0),
    feePerVisitMinor: round(avg((m) => m.feePerVisitMinor)),
    perAvailableHourMinor: round(avg((m) => m.perAvailableHourMinor)),
  };
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** A few plain prompts for the check-in, from where this month sits against their usual and the common ranges. */
export function promptsFor(m: Measures, u: Measures): string[] {
  const out: string[] = [];
  if (m.howFull != null && m.howFull < RANGES.howFull.low) {
    const spare = Math.max(0, Math.round(m.availableHours * RANGES.howFull.low - m.bookedHours));
    out.push(`Diary ${pct(m.howFull)} full: about ${spare} hours short of 75%. Are follow-ups being booked far enough ahead, and are their times on the waitlist?`);
  }
  if (m.howFull != null && m.howFull > 0.92) out.push(`Diary ${pct(m.howFull)} full: little room for new patients or urgent slots. Worth asking whether to add hours.`);
  if (m.missed != null && m.missed > RANGES.missed.high) out.push(`${pct(m.missed)} of appointments missed or cancelled late. Check reminders reach their patients, and that the cancellation policy is explained at booking.`);
  if (m.rebooked != null && u.rebooked != null && m.rebooked < u.rebooked - 0.08) out.push(`Fewer patients left with a next visit booked (${pct(m.rebooked)}, usually ${pct(u.rebooked)}). Is the plan of care being agreed in the session?`);
  if (m.visitsPerPatient != null && u.visitsPerPatient != null && m.visitsPerPatient < u.visitsPerPatient - 0.4) out.push(`Patients came ${m.visitsPerPatient} times on average, below their usual ${u.visitsPerPatient}. Some may be stopping before the end of their course.`);
  if (u.newPatients > 0 && m.newPatients < u.newPatients * 0.6) out.push(`${m.newPatients} new patients against a usual ${u.newPatients}. Check their profile and times are showing online.`);
  if (!out.length) out.push("In line with their usual and within the common ranges. A good month to ask what's working.");
  return out;
}

export function scorecard(o: { appts: Appt[]; hours: Hours; names: Record<string, string>; month: string; nowMs: number }): Scorecard {
  const today = day(new Date(o.nowMs).toISOString());
  const fromDay = monthStart(o.month);
  const toDay = monthEnd(o.month) < today ? monthEnd(o.month) : addDays(today, -1) < fromDay ? fromDay : addDays(today, -1);
  const soFar = monthEnd(o.month) >= today;
  const rows = Object.keys(o.hours).map((id): ScoreRow => {
    const mine = o.appts.filter((a) => a.practitionerId === id);
    const month = measures(mine, o.hours[id], fromDay, toDay, o.nowMs);
    const usual = usualOf([1, 2, 3].map((n) => shiftMonth(o.month, -n)).map((m) => measures(mine, o.hours[id], monthStart(m), monthEnd(m), o.nowMs)));
    // Part of a month: compare counts with what they'd usually have done in the same working time.
    if (soFar && usual.availableHours > 0) {
      const share = month.availableHours / usual.availableHours;
      usual.visits = Math.round(usual.visits * share);
      usual.newPatients = Math.round(usual.newPatients * share);
      usual.valueMinor = Math.round(usual.valueMinor * share);
    }
    return { practitionerId: id, name: o.names[id] ?? id, month, usual, prompts: promptsFor(month, usual) };
  });
  return { month: o.month, fromDay, toDay, soFar, computedAt: new Date(o.nowMs).toISOString(), rows };
}
