/**
 * Staff timesheets (12 Oct 2026), replacing Jane's. Pure, no I/O, unit-tested
 * in tests/timesheets.test.ts.
 *
 * - Times are Irish wall-clock times ("09:30") on a calendar day, stored as
 *   minutes after midnight, so a shift reads the same before and after the
 *   clocks change. A shift can't run past midnight: split it in two.
 * - Payable time = end − start − unpaid break.
 * - Only people with timesheets switched on (Team page) keep them. They see and
 *   change their own. Reception, owners and super admins see everyone's,
 *   correct them and export the hours.
 * - Better than Jane: clock in / clock out from a phone, weekly totals, a
 *   warning for overlapping or very long shifts, and who last changed each entry.
 */

export const TIMESHEET_TYPES = ["worked", "annual_leave", "sick", "public_holiday", "training", "other"] as const;
export type TimesheetType = (typeof TIMESHEET_TYPES)[number];

export const TYPE_LABEL: Record<TimesheetType, string> = {
  worked: "Worked",
  annual_leave: "Annual leave",
  sick: "Sick leave",
  public_holiday: "Public holiday",
  training: "Training",
  other: "Other",
};

export function isTimesheetType(v: unknown): v is TimesheetType {
  return typeof v === "string" && (TIMESHEET_TYPES as readonly string[]).includes(v);
}

/** "09:30" → 570. null if it isn't a real time. */
export function parseClock(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 570 → "09:30" (for inputs and CSV). */
export function clock(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/** 570 → "9:30am" (for people). */
export function clockLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** 250 → "4h 10m" (Jane's style). */
export function duration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** 250 → "4.17" hours, for payroll spreadsheets. */
export const decimalHours = (mins: number) => (mins / 60).toFixed(2);

export type EntryInput = {
  type: TimesheetType;
  day: string; // YYYY-MM-DD
  startMin: number;
  endMin: number | null; // null while clocked in
  breakMin: number;
  notes: string;
};

export type Entry = EntryInput & {
  id: string;
  userId: string;
  updatedAt: string;
  updatedBy: string | null;
};

export const MAX_SHIFT_MINUTES = 16 * 60;

export function payableMinutes(e: Pick<EntryInput, "startMin" | "endMin" | "breakMin">): number {
  if (e.endMin == null) return 0;
  return Math.max(0, e.endMin - e.startMin - e.breakMin);
}

const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;

/**
 * Problems with an entry, in plain words; empty when it's fine. `today` is the
 * Irish date, so a worked shift can't be logged for a day that hasn't
 * happened (leave can be booked ahead).
 */
export function entryProblems(e: EntryInput, today: string): string[] {
  const out: string[] = [];
  if (!isTimesheetType(e.type)) out.push("Choose a type.");
  if (!isDay(e.day)) out.push("Enter a date.");
  else if (e.type === "worked" && e.day > today) out.push("Worked time can't be for a day that hasn't happened yet.");
  else if (e.day < "2020-01-01" || e.day > addDays(today, 366)) out.push("That date is too far away.");
  if (!Number.isInteger(e.startMin) || e.startMin < 0 || e.startMin > 1439) out.push("Enter a start time.");
  if (e.endMin != null) {
    if (!Number.isInteger(e.endMin) || e.endMin < 0 || e.endMin > 1439) out.push("Enter an end time.");
    else if (e.endMin <= e.startMin) out.push("The end time must be after the start time. A shift past midnight goes in as two entries.");
    else if (e.endMin - e.startMin > MAX_SHIFT_MINUTES) out.push("That's longer than 16 hours. Check the times.");
  }
  if (!Number.isInteger(e.breakMin) || e.breakMin < 0) out.push("The unpaid break must be 0 or more minutes.");
  else if (e.endMin != null && e.endMin > e.startMin && e.breakMin >= e.endMin - e.startMin) out.push("The unpaid break is as long as the shift.");
  if (e.notes.length > 500) out.push("Keep notes under 500 characters.");
  return out;
}

/** Other entries the same person has that overlap this one on the same day (a warning, not a refusal). */
export function overlapping(e: Pick<Entry, "id" | "day" | "startMin" | "endMin">, others: Pick<Entry, "id" | "day" | "startMin" | "endMin">[]) {
  const end = (x: { startMin: number; endMin: number | null }) => x.endMin ?? x.startMin + 1;
  return others.filter((o) => o.id !== e.id && o.day === e.day && o.startMin < end(e) && e.startMin < end(o));
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday of `day`'s week. */
export function weekOf(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

/** Entries grouped by week (newest first), each with its total payable time. */
export function byWeek<T extends Pick<Entry, "day" | "startMin" | "endMin" | "breakMin">>(entries: T[]) {
  const weeks = new Map<string, T[]>();
  for (const e of [...entries].sort((a, b) => (a.day === b.day ? b.startMin - a.startMin : a.day < b.day ? 1 : -1))) {
    const w = weekOf(e.day);
    weeks.set(w, [...(weeks.get(w) ?? []), e]);
  }
  return [...weeks.entries()].map(([monday, list]) => ({
    monday,
    entries: list,
    totalMin: list.reduce((s, e) => s + payableMinutes(e), 0),
  }));
}

/** Totals per person and type over a period, for the report. */
export function totals<T extends Pick<Entry, "userId" | "type" | "startMin" | "endMin" | "breakMin">>(entries: T[]) {
  const out = new Map<string, { totalMin: number; byType: Partial<Record<TimesheetType, number>> }>();
  for (const e of entries) {
    const t = out.get(e.userId) ?? { totalMin: 0, byType: {} };
    const p = payableMinutes(e);
    t.totalMin += p;
    t.byType[e.type] = (t.byType[e.type] ?? 0) + p;
    out.set(e.userId, t);
  }
  return out;
}

const csvCell = (v: string) => {
  // Neutralise spreadsheet formulas (CSV injection) and quote everything.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** A CSV a payroll spreadsheet opens directly: one row per entry. */
export function toCsv(rows: Array<Pick<Entry, "day" | "type" | "startMin" | "endMin" | "breakMin" | "notes"> & { name: string }>): string {
  const head = ["Name", "Date", "Type", "Start", "End", "Unpaid break (min)", "Payable (h:mm)", "Payable (hours)", "Notes"];
  const lines = rows.map((r) => {
    const p = payableMinutes(r);
    return [
      r.name,
      r.day,
      TYPE_LABEL[r.type],
      clock(r.startMin),
      r.endMin == null ? "" : clock(r.endMin),
      String(r.breakMin),
      `${Math.floor(p / 60)}:${String(p % 60).padStart(2, "0")}`,
      decimalHours(p),
      r.notes,
    ]
      .map(csvCell)
      .join(",");
  });
  return [head.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}

/** Who may see or change whose timesheets. */
export function timesheetRefusal(args: {
  actor: { id: string; seeAll: boolean; enabled: boolean };
  ownerId: string;
  ownerEnabled: boolean;
}): string | null {
  const { actor, ownerId, ownerEnabled } = args;
  if (actor.id === ownerId) return actor.enabled ? null : "Timesheets aren't switched on for you. Ask an owner.";
  if (!actor.seeAll) return "You can only see your own timesheets.";
  if (!ownerEnabled) return "Timesheets aren't switched on for that person.";
  return null;
}
