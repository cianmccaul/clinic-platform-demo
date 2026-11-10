/**
 * The Clinic Tree tasks tab (decision 20 Oct 2026; Cian's research report).
 * Pure, no I/O, unit-tested in tests/tasks.test.ts.
 *
 * - Reception / admin, owners and super admins use it. Anyone of them can
 *   put a task straight onto anyone else's list ("From Clare").
 * - Sections: Today, This week, Later. Order within a section is manual;
 *   high-priority tasks sit at the top.
 * - Sizes S/M/L = 1/2/4 points, so a big job counts for more.
 * - The week runs Monday to Sunday (Irish time). Progress = points done this
 *   week ÷ points that belong to this week (done this week, or still open in
 *   Today or This week, or due by Sunday). The tree starts each week as a
 *   sprout and blossoms at 100%. Nothing withers: a finished week is planted
 *   in the grove at the size it reached.
 * - Repeating tasks: weekly (a weekday) or monthly (a day of the month; a day
 *   the month doesn't have means its last day). Either moves to the working
 *   day before when it falls on a weekend or an Irish bank holiday.
 * - Not used for appraisal: there are no rankings, and nobody sees anyone
 *   else's private tree.
 */

export const TASK_SIZES = { S: 1, M: 2, L: 4 } as const;
export type TaskSize = keyof typeof TASK_SIZES;
export const BANDS = ["today", "week", "later"] as const;
export type Band = (typeof BANDS)[number];
export const BAND_LABEL: Record<Band, string> = { today: "Today", week: "This week", later: "Later" };
export const PRIORITIES = ["normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Above this many points open in Today + This week, the list nudges to keep it manageable. */
export const NUDGE_POINTS = 20;
export const MAX_TITLE = 120;
export const MAX_NOTES = 500;

export type TaskRule = { kind: "weekly"; weekday: number /* 0 = Monday … 6 = Sunday */ } | { kind: "monthly"; day: number /* 1–31 */ };

// ---------- calendar ----------

const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const noon = (day: string) => Date.parse(`${day}T12:00:00Z`);
export const addDays = (day: string, n: number) => toDay(noon(day) + n * 86_400_000);
/** 0 = Monday … 6 = Sunday. */
export const weekday = (day: string) => (new Date(noon(day)).getUTCDay() + 6) % 7;
export const mondayOf = (day: string) => addDays(day, -weekday(day));

function easterSunday(year: number): string {
  // Anonymous Gregorian algorithm.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

const nthMonday = (year: number, month: number, n: number) => {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  return addDays(first, ((7 - weekday(first)) % 7) + (n - 1) * 7);
};
const lastMonday = (year: number, month: number) => {
  const last = toDay(Date.UTC(year, month, 0, 12));
  return addDays(last, -weekday(last));
};

/** Irish public holidays in a year, including the days off given when one falls at a weekend. */
export function irishBankHolidays(year: number): Set<string> {
  const ymd = (m: number, d: number) => `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const feb1 = ymd(2, 1);
  const brigid = weekday(feb1) === 4 ? feb1 : nthMonday(year, 2, 1); // 1 Feb if a Friday, else the first Monday
  const fixed = [ymd(1, 1), ymd(3, 17), ymd(12, 25), ymd(12, 26)];
  const moving = [brigid, addDays(easterSunday(year), 1), nthMonday(year, 5, 1), nthMonday(year, 6, 1), nthMonday(year, 8, 1), lastMonday(year, 10)];
  const out = new Set<string>([...fixed, ...moving]);
  // A fixed holiday at the weekend gives the next weekday that isn't already a holiday.
  for (const d of fixed) {
    if (weekday(d) < 5) continue;
    let sub = addDays(d, 1);
    while (weekday(sub) >= 5 || out.has(sub)) sub = addDays(sub, 1);
    out.add(sub);
  }
  return out;
}

const holidayCache = new Map<number, Set<string>>();
export function isWorkingDay(day: string): boolean {
  const y = Number(day.slice(0, 4));
  if (!holidayCache.has(y)) holidayCache.set(y, irishBankHolidays(y));
  return weekday(day) < 5 && !holidayCache.get(y)!.has(day);
}
export function previousWorkingDayOnOrBefore(day: string): string {
  let d = day;
  for (let i = 0; i < 14 && !isWorkingDay(d); i++) d = addDays(d, -1);
  return d;
}
export function addWorkingDays(day: string, n: number): string {
  let d = day;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isWorkingDay(d)) left--;
  }
  return d;
}

/** The due days of a repeating task between two days (both included), after the weekend/holiday rule. */
export function occurrences(rule: TaskRule, from: string, to: string): string[] {
  const out = new Set<string>();
  // Start a little early: a raw date just after `from` can move back before it, and one just after `to` can move into range.
  for (let d = addDays(from, -7); d <= addDays(to, 7); d = addDays(d, 1)) {
    let raw = false;
    if (rule.kind === "weekly") raw = weekday(d) === rule.weekday;
    else {
      const last = Number(toDay(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0, 12)).slice(8, 10));
      raw = Number(d.slice(8, 10)) === Math.min(rule.day, last);
    }
    if (!raw) continue;
    const due = previousWorkingDayOnOrBefore(d);
    if (due >= from && due <= to) out.add(due);
  }
  return [...out].sort();
}

export function ruleLabel(rule: TaskRule): string {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  if (rule.kind === "weekly") return `Every ${days[rule.weekday]}`;
  const sfx = (n: number) => (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  return `Monthly on the ${rule.day}${sfx(rule.day)}`;
}

/**
 * Where a task with a due day should be, never lower than where it is:
 * due by the next working day → Today; due by Sunday, or within 5 working
 * days → This week.
 */
export function promotedBand(band: Band, dueDay: string | null, today: string): Band {
  if (!dueDay || band === "today") return band;
  if (dueDay <= addWorkingDays(today, 1)) return "today";
  const sunday = addDays(mondayOf(today), 6);
  if (band === "later" && (dueDay <= sunday || dueDay <= addWorkingDays(today, 5))) return "week";
  return band;
}

// ---------- progress ----------

export type ProgressTask = {
  points: number;
  band: Band;
  dueDay: string | null;
  doneAt: string | null; // ISO
  droppedAt: string | null;
};

/** Does a task count towards the week starting `monday`, and is it done in it? */
export function weekPoints(tasks: ProgressTask[], monday: string, dublinDayOf: (iso: string) => string): { done: number; total: number } {
  const sunday = addDays(monday, 6);
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    if (t.doneAt) {
      const d = dublinDayOf(t.doneAt);
      if (d >= monday && d <= sunday) {
        done += t.points;
        total += t.points;
      }
      continue;
    }
    if (t.droppedAt) continue;
    if (t.band !== "later" || (t.dueDay != null && t.dueDay <= sunday)) total += t.points;
  }
  return { done, total };
}

export const percent = (p: { done: number; total: number }) => (p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0);

/** Tree stages 1–6: sprout, sapling, young tree, growing tree, full tree, blossom. Every week starts at 1. */
export const STAGE_LABEL = ["", "Sprout", "Sapling", "Young tree", "Growing tree", "Full tree", "Blossoming tree"];
export function treeStage(pct: number): number {
  if (pct >= 100) return 6;
  return Math.min(5, 1 + Math.floor(pct / 20));
}

/** Points open in Today + This week: above NUDGE_POINTS, suggest moving something to Later. */
export function openWeekLoad(tasks: ProgressTask[]): number {
  return tasks.filter((t) => !t.doneAt && !t.droppedAt && t.band !== "later").reduce((s, t) => s + t.points, 0);
}
