/**
 * KPI dashboard for owners and super admins (decision 20 Oct 2026). Pure:
 * the numbers are worked out here from plain rows that lib/kpis.ts reads
 * from Cliniko and the Hub. Unit-tested in tests/kpis.test.ts.
 *
 * Definitions (shown on the page too):
 * - Appointment: any appointment starting in the period (cancelled ones too).
 * - Attended: not cancelled, not marked Did not arrive, already started.
 * - New patient: their appointment in the period is a "New patient" type.
 *   (Cliniko's history only starts at the Jane transfer, so "first visit
 *   ever" can't be worked out yet; the appointment type can.)
 * - Late cancellation: cancelled less than 24 hours before the start.
 * - No-show rate: Did not arrive ÷ (attended + Did not arrive).
 * - Booked again: of the patients who attended in the period, the share with
 *   another appointment booked within 6 weeks of their last visit in it.
 * - Revenue: invoices issued in Cliniko in the period (credit notes count
 *   as negative), and payments taken online through the Hub, net of refunds.
 */
import { CANCEL_WINDOW_HOURS } from "./policy.ts";

export const REBOOK_WINDOW_DAYS = 42;
export const MAX_KPI_DAYS = 93; // about 3 months per look; longer ranges come with the overnight job

export type KpiAppointment = {
  id: string;
  startsAt: string; // ISO
  practitionerId: string;
  patientId: string;
  typeName: string;
  cancelledAt: string | null;
  didNotArrive: boolean;
};
export type KpiInvoice = { practitionerId: string; totalMinor: number; issueDate: string };
export type KpiOnlinePayment = { practitionerId: string; netMinor: number; at: string };

export type KpiStats = {
  appointments: number;
  attended: number;
  upcoming: number;
  cancelled: number;
  lateCancelled: number;
  noShows: number;
  patients: number;
  newPatients: number;
  returningPatients: number;
  bookedAgain: number; // patients
  bookedAgainOf: number; // patients who attended
  invoicedMinor: number;
  invoices: number;
  onlineMinor: number;
};

export type KpiResult = {
  from: string; // YYYY-MM-DD, Irish days, both included
  to: string;
  computedAt: string;
  clinic: KpiStats;
  byPractitioner: Record<string, KpiStats>;
  /** busiest[weekday 0=Mon..6=Sun][hour 0..23] = appointments (not cancelled). */
  busiest: number[][];
  referrals: { source: string; count: number }[];
};

export const isNewPatientType = (typeName: string) => /\bnew\s+patient\b/i.test(typeName);

const empty = (): KpiStats => ({
  appointments: 0,
  attended: 0,
  upcoming: 0,
  cancelled: 0,
  lateCancelled: 0,
  noShows: 0,
  patients: 0,
  newPatients: 0,
  returningPatients: 0,
  bookedAgain: 0,
  bookedAgainOf: 0,
  invoicedMinor: 0,
  invoices: 0,
  onlineMinor: 0,
});

const DUBLIN_PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", weekday: "short", hour: "2-digit", hourCycle: "h23" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function dublinWeekdayHour(iso: string): { weekday: number; hour: number } {
  const parts = DUBLIN_PARTS.formatToParts(new Date(iso));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hr = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return { weekday: Math.max(0, WEEKDAYS.indexOf(wd)), hour: hr % 24 };
}

/** "Google — Dr Byrne" → "Google". Blank → "Not given". */
export const referralBucket = (s: string | null | undefined) => (s ?? "").split(" — ")[0].trim() || "Not given";

/**
 * `appointments` must cover the period plus REBOOK_WINDOW_DAYS after it (for
 * "booked again"); only those starting inside [fromMs, toMs) are counted as
 * the period's appointments.
 */
export function computeKpis(input: {
  from: string;
  to: string;
  fromMs: number;
  toMs: number; // exclusive: midnight after `to`
  nowMs: number;
  appointments: KpiAppointment[];
  invoices: KpiInvoice[];
  online: KpiOnlinePayment[];
  newPatientReferrals: (string | null)[];
}): KpiResult {
  const clinic = empty();
  const by: Record<string, KpiStats> = {};
  const statsFor = (pid: string) => (by[pid] ??= empty());
  const busiest = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);

  const seen = new Set<string>();
  const appts = input.appointments.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  const inPeriod = appts.filter((a) => {
    const t = Date.parse(a.startsAt);
    return t >= input.fromMs && t < input.toMs;
  });

  // Per (scope, patient): new?, last attended visit.
  type P = { isNew: boolean; lastAttended: number | null };
  const clinicPatients = new Map<string, P>();
  const pracPatients = new Map<string, Map<string, P>>();
  const touch = (m: Map<string, P>, patientId: string) => {
    let p = m.get(patientId);
    if (!p) m.set(patientId, (p = { isNew: false, lastAttended: null }));
    return p;
  };

  for (const a of inPeriod) {
    const t = Date.parse(a.startsAt);
    const s = statsFor(a.practitionerId);
    for (const x of [clinic, s]) x.appointments++;
    if (a.cancelledAt) {
      const late = Date.parse(a.startsAt) - Date.parse(a.cancelledAt) < CANCEL_WINDOW_HOURS * 3_600_000;
      for (const x of [clinic, s]) {
        x.cancelled++;
        if (late) x.lateCancelled++;
      }
      continue;
    }
    const { weekday, hour } = dublinWeekdayHour(a.startsAt);
    busiest[weekday][hour]++;
    const pm = (pracPatients.get(a.practitionerId) ?? pracPatients.set(a.practitionerId, new Map()).get(a.practitionerId))!;
    const cp = touch(clinicPatients, a.patientId);
    const pp = touch(pm, a.patientId);
    if (isNewPatientType(a.typeName)) cp.isNew = pp.isNew = true;
    if (a.didNotArrive) {
      for (const x of [clinic, s]) x.noShows++;
    } else if (t <= input.nowMs) {
      for (const x of [clinic, s]) x.attended++;
      cp.lastAttended = Math.max(cp.lastAttended ?? 0, t);
      pp.lastAttended = Math.max(pp.lastAttended ?? 0, t);
    } else {
      for (const x of [clinic, s]) x.upcoming++;
    }
  }

  // Later appointments per patient (any practitioner for the clinic; the same one per therapist).
  const later = new Map<string, { t: number; practitionerId: string }[]>();
  for (const a of appts) {
    if (a.cancelledAt) continue;
    (later.get(a.patientId) ?? later.set(a.patientId, []).get(a.patientId))!.push({ t: Date.parse(a.startsAt), practitionerId: a.practitionerId });
  }
  const windowMs = REBOOK_WINDOW_DAYS * 86_400_000;
  const tally = (stats: KpiStats, m: Map<string, P>, practitionerId: string | null) => {
    for (const [patientId, p] of m) {
      stats.patients++;
      if (p.isNew) stats.newPatients++;
      else stats.returningPatients++;
      if (p.lastAttended == null) continue;
      stats.bookedAgainOf++;
      const next = (later.get(patientId) ?? []).some(
        (x) => x.t > p.lastAttended! && x.t <= p.lastAttended! + windowMs && (practitionerId == null || x.practitionerId === practitionerId)
      );
      if (next) stats.bookedAgain++;
    }
  };
  tally(clinic, clinicPatients, null);
  for (const [pid, m] of pracPatients) tally(statsFor(pid), m, pid);

  for (const inv of input.invoices) {
    const s = statsFor(inv.practitionerId);
    for (const x of [clinic, s]) {
      x.invoicedMinor += inv.totalMinor;
      if (inv.totalMinor > 0) x.invoices++;
    }
  }
  for (const p of input.online) {
    const s = statsFor(p.practitionerId);
    for (const x of [clinic, s]) x.onlineMinor += p.netMinor;
  }

  const counts = new Map<string, number>();
  for (const r of input.newPatientReferrals) {
    const k = referralBucket(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const referrals = [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  return { from: input.from, to: input.to, computedAt: new Date(input.nowMs).toISOString(), clinic, byPractitioner: by, busiest, referrals };
}

/** A percentage to show, or null when there's nothing to divide by. */
export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** The period's presets, as Irish days. */
export function kpiPresets(today: string): { id: string; label: string; from: string; to: string }[] {
  const [y, m] = today.split("-").map(Number);
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(Date.parse(`${today}T12:00:00Z`) - dow * 86_400_000).toISOString().slice(0, 10);
  const m3 = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10);
  return [
    { id: "week", label: "This week", from: monday, to: today },
    { id: "month", label: "This month", from: iso(y, m, 1), to: today },
    { id: "last-month", label: "Last month", from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) },
    { id: "3-months", label: "Last 3 months", from: m3, to: today },
  ];
}
