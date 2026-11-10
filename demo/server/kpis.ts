/**
 * The KPI report, worked out by the real code (core/kpi2-report.ts) from the
 * demo's diary. The demo only stores a fortnight either side of today, so the
 * months before that are filled in with made-up history (same every day,
 * never saved) to give the trends something to compare against.
 */
import { buildReport, type KpiReport } from "@/core/kpi2-report";
import { type Appt, type Availability, addDays, modalityOf } from "@/core/kpi2";
import { dublinDay } from "@/core/policy";
import { PRACTITIONERS, practitionerName, priceMinor, typeById } from "./clinic";
import type { Db } from "./db";
import { dublinTime, plusMinutes, weekday } from "./diary";
import { rng } from "./seed";

const HISTORY_WEEKS = 40;
/** The seed covers 13 days back; before that is made-up history. */
const SEEDED_DAYS_BACK = 13;

const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

function history(today: string): Appt[] {
  const first = addDays(today, -7 * HISTORY_WEEKS - 7);
  const last = addDays(today, -SEEDED_DAYS_BACK - 1);
  const r = rng(Number(first.replaceAll("-", "")));
  const pools = new Map<string, string[]>();
  let nextPatient = 1;
  const out: Appt[] = [];
  let i = 0;
  for (let day = first; day <= last; day = addDays(day, 1), i++) {
    const week = Math.floor(i / 7);
    // Busier over the months, with a summer dip and some week-to-week noise.
    const fill = 0.82 + 0.08 * (week / HISTORY_WEEKS) - (day.slice(5, 7) === "08" ? 0.12 : 0) + (r() - 0.5) * 0.12;
    for (const p of PRACTITIONERS) {
      const hours = p.hours[weekday(day)];
      if (!hours) continue;
      const close = dublinTime(day, hours[1]);
      for (let s = dublinTime(day, hours[0]); plusMinutes(s, 60) <= close; s = plusMinutes(s, 60)) {
        if (r() > fill) continue;
        const pool = pools.get(p.id) ?? [];
        const isNew = pool.length < 8 || r() < 0.2;
        const typeId = p.offers.find((t) => (isNew ? /New/ : /Returning/).test(typeById(t)!.name)) ?? p.offers[0];
        const patientId = isNew ? `h${nextPatient++}` : pool[Math.floor(r() * Math.min(pool.length, 40))];
        if (isNew) pools.set(p.id, [patientId, ...pool].slice(0, 60));
        const t = typeById(typeId)!;
        const startMs = Date.parse(s);
        const cancelled = r() < 0.06;
        // Most follow-ups are booked at the desk after the last visit; the rest a few days ahead.
        const createdMs = !isNew && r() < 0.85 ? startMs - 7 * 86_400_000 + 3_600_000 : startMs - (1 + r() * 9) * 86_400_000;
        out.push({
          id: `h${out.length}`,
          patientId,
          practitionerId: p.id,
          typeName: t.name,
          modality: modalityOf(t.category, t.name),
          startsAt: s,
          endsAt: plusMinutes(s, t.duration_in_minutes),
          createdAt: new Date(createdMs).toISOString(),
          cancelledAt: cancelled ? new Date(startMs - r() * 3 * 86_400_000).toISOString() : null,
          didNotArrive: !cancelled && r() < 0.025,
          priceMinor: priceMinor(t.id),
        });
      }
    }
  }
  return out;
}

/** Every appointment the report looks at: the made-up history, then the demo diary. */
export function kpiAppointments(db: Db, now: number): Appt[] {
  const appts: Appt[] = history(dublinDay(new Date(now).toISOString()));
  for (const a of db.appointments) {
    const t = typeById(a.appointment_type_id);
    if (!t) continue;
    appts.push({
      id: a.id, patientId: a.patient_id, practitionerId: a.practitioner_id, typeName: t.name, modality: modalityOf(t.category, t.name),
      startsAt: a.starts_at, endsAt: a.ends_at, createdAt: a.created_at, cancelledAt: a.cancelled_at, didNotArrive: a.did_not_arrive, priceMinor: priceMinor(t.id),
    });
  }
  return appts;
}

export function kpiReport(db: Db, now: number): KpiReport & { practitioners: Record<string, string>; target: { month: string; set: boolean } } {
  const today = dublinDay(new Date(now).toISOString());
  const appts = kpiAppointments(db, now);
  const availabilities: Availability[] = PRACTITIONERS.flatMap((p) =>
    Object.entries(p.hours).map(([dow, h]) => ({ practitionerId: p.id, dayOfWeek: Number(dow), ranges: [[hm(h![0]), hm(h![1])]] as [number, number][] })),
  );
  const feesMinorByDay: Record<string, number> = {};
  for (const b of Object.values(db.bookings)) {
    for (const p of b.payments) {
      if (p.kind !== "no_show" && p.kind !== "late_cancel") continue;
      const day = dublinDay(b.startsAtISO);
      feesMinorByDay[day] = (feesMinorByDay[day] ?? 0) + p.amountMinor - p.refundedMinor;
    }
  }
  const report = buildReport({ nowMs: now, appts, availabilities, unavailable: [], extra: [], feesMinorByDay }, { targetMinor: db.kpiTargetMinor ?? null });
  const practitioners: Record<string, string> = {};
  for (const p of PRACTITIONERS) practitioners[p.id] = practitionerName(p.id);
  return { ...report, practitioners, target: { month: today.slice(0, 7), set: db.kpiTargetMinor != null } };
}
