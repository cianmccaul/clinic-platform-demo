/**
 * Extra working days (Shifts page, 31 Oct 2026). Cliniko's regular hours only
 * repeat every week, so a therapist who works alternate Saturdays, or two
 * Mondays a month, has those days added by the Hub as one-off "availability"
 * in their Cliniko diary. Online booking and Cliniko then both offer those times.
 *
 * Pure, no I/O, unit-tested. Storage and the Cliniko writes: lib/shifts.ts.
 *
 * Three kinds of rule:
 * - dates:           days picked by hand ("these two Mondays this month")
 * - every_n_weeks:   every 2nd (3rd, 4th) week from a first day, e.g. alternate Saturdays
 * - weeks_of_month:  e.g. the 1st and 3rd Monday of each month; 5 = a 5th one when the month has it, -1 = the last
 *
 * Repeating rules are added HORIZON_DAYS ahead and topped up every night.
 */
import { addDays } from "./policy.ts";

export const HORIZON_DAYS = 91; // about 3 months
export const MAX_DATES = 60;
export const MAX_AHEAD_DAYS = 400; // a picked date or a first day at most ~13 months out
export const MAX_SHIFT_MINUTES = 14 * 60;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type WeekOfMonth = 1 | 2 | 3 | 4 | 5 | -1;
export const WEEK_LABEL: Record<WeekOfMonth, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", [-1]: "last" } as Record<WeekOfMonth, string>;

export type ShiftPattern =
  | { kind: "dates"; dates: string[] }
  | { kind: "every_n_weeks"; firstDay: string; every: 2 | 3 | 4; untilDay?: string | null }
  | { kind: "weeks_of_month"; weekday: number; weeks: WeekOfMonth[]; fromDay: string; untilDay?: string | null };

export type ShiftRuleInput = {
  practitionerId: string;
  businessId: string;
  /** "09:00" (24-hour, Irish time) */
  start: string;
  end: string;
  pattern: ShiftPattern;
  note?: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isDay = (s: unknown): s is string => typeof s === "string" && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
export const clockMinutes = (hm: string) => {
  const m = CLOCK.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
/** Day of the week of a calendar day, 0 = Sunday. */
export const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Which week of its month a day is: 1 for the first such weekday, 2 for the second… */
export const weekOfMonth = (day: string) => Math.ceil(Number(day.slice(8, 10)) / 7);
/** Is it the last such weekday of its month? */
export const isLastOfMonth = (day: string) => addDays(day, 7).slice(0, 7) !== day.slice(0, 7);

/** The days a rule covers between fromDay and toDay (both included), in order. */
export function daysFor(pattern: ShiftPattern, fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  if (pattern.kind === "dates") return [...new Set(pattern.dates)].filter((d) => d >= fromDay && d <= toDay).sort();
  const until = pattern.untilDay && pattern.untilDay < toDay ? pattern.untilDay : toDay;
  if (pattern.kind === "every_n_weeks") {
    let d = pattern.firstDay;
    if (d < fromDay) {
      const step = 7 * pattern.every;
      d = addDays(d, Math.ceil(daysBetween(d, fromDay) / step) * step);
    }
    for (; d <= until; d = addDays(d, 7 * pattern.every)) out.push(d);
    return out;
  }
  let d = pattern.fromDay > fromDay ? pattern.fromDay : fromDay;
  d = addDays(d, (pattern.weekday - weekdayOf(d) + 7) % 7);
  for (; d <= until; d = addDays(d, 7)) {
    if (pattern.weeks.includes(weekOfMonth(d) as WeekOfMonth) || (pattern.weeks.includes(-1) && isLastOfMonth(d))) out.push(d);
  }
  return out;
}

export const repeats = (p: ShiftPattern) => p.kind !== "dates";

/** What's wrong with a new rule, in words for the page. Empty when it can be added. */
export function ruleProblems(r: ShiftRuleInput, today: string): string[] {
  const problems: string[] = [];
  if (!r.practitionerId) problems.push("Choose the therapist.");
  if (!r.businessId) problems.push("Choose the location.");
  const s = clockMinutes(r.start);
  const e = clockMinutes(r.end);
  if (Number.isNaN(s) || Number.isNaN(e)) problems.push("Enter the start and finish times, like 09:00 and 17:00.");
  else if (e <= s) problems.push("The finish time must be after the start time.");
  else if (e - s > MAX_SHIFT_MINUTES) problems.push("That's longer than 14 hours. Check the times.");
  const last = addDays(today, MAX_AHEAD_DAYS);
  const p = r.pattern;
  if (p.kind === "dates") {
    if (!p.dates.length) problems.push("Pick at least one date.");
    if (p.dates.length > MAX_DATES) problems.push(`Pick at most ${MAX_DATES} dates at a time.`);
    if (p.dates.some((d) => !isDay(d))) problems.push("One of the dates isn't a real date.");
    else if (p.dates.some((d) => d < today)) problems.push("One of the dates is in the past.");
    else if (p.dates.some((d) => d > last)) problems.push("One of the dates is more than a year away.");
  } else {
    const first = p.kind === "every_n_weeks" ? p.firstDay : p.fromDay;
    if (!isDay(first)) problems.push(p.kind === "every_n_weeks" ? "Pick the first day." : "Pick the day to start from.");
    else if (first < today) problems.push("The first day can't be in the past.");
    else if (first > last) problems.push("The first day is more than a year away.");
    if (p.untilDay != null && p.untilDay !== "" && (!isDay(p.untilDay) || (isDay(first) && p.untilDay < first))) problems.push("The end date must be after the first day.");
    if (p.kind === "every_n_weeks" && ![2, 3, 4].includes(p.every)) problems.push("Choose every 2, 3 or 4 weeks.");
    if (p.kind === "weeks_of_month") {
      if (!(p.weekday >= 0 && p.weekday <= 6)) problems.push("Choose the day of the week.");
      if (!p.weeks.length) problems.push("Tick at least one week of the month.");
    }
    if (!problems.length && !daysFor(p, today, addDays(today, MAX_AHEAD_DAYS)).length) problems.push("That rule doesn't give any days. Check the dates.");
  }
  if ((r.note ?? "").length > 120) problems.push("Keep the note under 120 characters.");
  return problems;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sat 7 Nov" */
const niceDay = (day: string) => `${WEEKDAYS[weekdayOf(day)].slice(0, 3)} ${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function clockText(hm: string) {
  const m = clockMinutes(hm);
  if (Number.isNaN(m)) return hm;
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** "Every other Saturday from Sat 7 Nov, 9:00am–1:00pm". */
export function describeRule(r: Pick<ShiftRuleInput, "start" | "end" | "pattern">) {
  const hours = `${clockText(r.start)}–${clockText(r.end)}`;
  const p = r.pattern;
  const until = p.kind !== "dates" && p.untilDay ? ` until ${niceDay(p.untilDay)}` : "";
  if (p.kind === "dates") return `${p.dates.length === 1 ? niceDay(p.dates[0]) : `${p.dates.length} chosen days`}, ${hours}`;
  if (p.kind === "every_n_weeks") {
    const every = p.every === 2 ? "Every other" : `Every ${p.every === 3 ? "3rd" : "4th"}`;
    return `${every} ${WEEKDAYS[weekdayOf(p.firstDay)]} from ${niceDay(p.firstDay)}${until}, ${hours}`;
  }
  const weeks = [...p.weeks].sort((a, b) => (a === -1 ? 9 : a) - (b === -1 ? 9 : b)).map((w) => WEEK_LABEL[w]);
  const day = WEEKDAYS[p.weekday] + (p.weeks.length > 1 ? "s" : "");
  return `The ${list(weeks)} ${day} of each month, from ${niceDay(p.fromDay)}${until}, ${hours}`;
}

export { niceDay };

/**
 * The UTC instant of a wall-clock time in Ireland on a calendar day, DST-aware
 * (the clocks change at 1am, never during clinic hours).
 */
export function dublinTimeToUTC(day: string, hm: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const wall = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  };
  const guess = Date.parse(`${day}T${hm}:00Z`);
  for (const offsetHours of [0, 1]) {
    const t = guess - offsetHours * 3_600_000;
    if (wall(t) === `${day} ${hm}`) return new Date(t).toISOString();
  }
  return new Date(guess).toISOString();
}

export type ShiftDayStatus = "to_add" | "adding" | "added" | "failed" | "to_remove" | "removed";
export const STATUS_LABEL: Record<ShiftDayStatus, string> = {
  to_add: "Waiting to be added",
  adding: "Being added",
  added: "In Cliniko",
  failed: "Couldn't be added",
  to_remove: "Remove in Cliniko",
  removed: "Removed",
};
