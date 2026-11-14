/**
 * The clinic diary: stands in for Cliniko. Availability is worked out from
 * each practitioner's hours, minus appointments and live holds, the way
 * Cliniko's available_times does it.
 */
import { addDays, dublinDay, dublinMidnightUTC } from "@/core/policy";
import { machineClash, machinesFor } from "@/core/machines";
import { BUSINESS, practitionerById, typeById } from "./clinic";
import { type Appointment, type Db, type Hold, type Patient, nextId, norm } from "./db";

const STEP_MINUTES = 15;

/** An ISO instant for a clock time ("09:30") on an Irish calendar day. */
export function dublinTime(day: string, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(dublinMidnightUTC(day) + (h * 60 + m) * 60_000).toISOString();
}
export const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const plusMinutes = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart < bEnd && bStart < aEnd;

export const liveAppointments = (db: Db) => db.appointments.filter((a) => !a.cancelled_at);

/** Free for this practitioner? Live appointments block it, and so does someone else's hold. */
export function isFree(db: Db, practitionerId: string, startsAt: string, endsAt: string, now: number, opts: { holdOwner?: string; excludeAppointmentId?: string } = {}) {
  const nowIso = new Date(now).toISOString();
  if (liveAppointments(db).some((a) => a.practitioner_id === practitionerId && a.id !== opts.excludeAppointmentId && overlaps(startsAt, endsAt, a.starts_at, a.ends_at))) return false;
  return !db.holds.some((h) => h.practitionerId === practitionerId && h.owner !== opts.holdOwner && h.expiresAt > nowIso && overlaps(startsAt, endsAt, h.startsAt, h.endsAt));
}

/** The one shockwave machine and the one laser: the Hub never books two at once (core/machines.ts). */
export function machineFree(db: Db, typeId: string, startsAt: string, endsAt: string, excludeAppointmentId?: string) {
  if (!machinesFor(typeId).length) return true;
  const existing = liveAppointments(db)
    .filter((a) => a.id !== excludeAppointmentId && machinesFor(a.appointment_type_id).length)
    .map((a) => ({ id: a.id, appointmentTypeId: a.appointment_type_id, startMs: Date.parse(a.starts_at), endMs: Date.parse(a.ends_at) }));
  return !machineClash({ appointmentTypeId: typeId, startMs: Date.parse(startsAt), endMs: Date.parse(endsAt) }, existing);
}

export function withinHours(practitionerId: string, startsAt: string, endsAt: string) {
  const day = dublinDay(startsAt);
  const hours = practitionerById(practitionerId)?.hours[weekday(day)];
  return !!hours && startsAt >= dublinTime(day, hours[0]) && endsAt <= dublinTime(day, hours[1]);
}

/** Cliniko-style available times for one practitioner and type, Irish dates inclusive. */
export function availableTimes(db: Db, practitionerId: string, typeId: string, fromDay: string, toDay: string, now: number, opts: { excludeAppointmentId?: string; holdOwner?: string } = {}) {
  const p = practitionerById(practitionerId);
  const t = typeById(typeId);
  if (!p || !t || !p.offers.includes(t.id)) return [];
  const earliest = new Date(now + 60 * 60_000).toISOString();
  const out: string[] = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    const hours = p.hours[weekday(day)];
    if (!hours) continue;
    const close = dublinTime(day, hours[1]);
    for (let s = dublinTime(day, hours[0]); plusMinutes(s, t.duration_in_minutes) <= close; s = plusMinutes(s, STEP_MINUTES)) {
      const e = plusMinutes(s, t.duration_in_minutes);
      // Cliniko offers times on the hour and half hour for these types.
      if (new Date(s).getUTCMinutes() % 30 !== 0) continue;
      if (s >= earliest && isFree(db, p.id, s, e, now, opts) && machineFree(db, t.id, s, e, opts.excludeAppointmentId)) out.push(s);
    }
  }
  return out;
}

export function nextAvailable(db: Db, practitionerId: string, typeId: string, now: number) {
  const today = dublinDay(new Date(now).toISOString());
  return availableTimes(db, practitionerId, typeId, today, addDays(today, 41), now)[0] ?? null;
}

export function isSlotAvailable(db: Db, practitionerId: string, typeId: string, startsAt: string, now: number, opts: { holdOwner?: string; excludeAppointmentId?: string } = {}) {
  const t = typeById(typeId);
  if (!t) return false;
  const end = plusMinutes(startsAt, t.duration_in_minutes);
  return withinHours(practitionerId, startsAt, end) && isFree(db, practitionerId, startsAt, end, now, opts) && machineFree(db, t.id, startsAt, end, opts.excludeAppointmentId);
}

export function hold(db: Db, now: number, h: Omit<Hold, "expiresAt">, minutes: number) {
  db.holds = db.holds.filter((x) => x.owner !== h.owner);
  db.holds.push({ ...h, expiresAt: new Date(now + minutes * 60_000).toISOString() });
}
export const releaseHold = (db: Db, owner: string) => (db.holds = db.holds.filter((h) => h.owner !== owner));

export function findPatientsByEmail(db: Db, email: string) {
  return db.patients.filter((p) => norm(p.email) === norm(email));
}

export function findOrCreatePatient(db: Db, now: number, d: { firstName: string; lastName: string; email: string; phone?: string; dateOfBirth?: string; address?: string; county?: string; eircode?: string; gpName?: string; heardAboutUs?: string }): Patient {
  const found = db.patients.find((p) => norm(p.email) === norm(d.email) && p.last_name.toLowerCase() === d.lastName.trim().toLowerCase() && p.first_name.toLowerCase() === d.firstName.trim().toLowerCase());
  if (found) return found;
  const p: Patient = { id: nextId(db), first_name: d.firstName.trim(), last_name: d.lastName.trim(), email: d.email.trim(), phone: d.phone ?? "", date_of_birth: d.dateOfBirth || null, created_at: new Date(now).toISOString(),
    ...(d.address ? { address_1: d.address } : {}), ...(d.county ? { state: d.county } : {}), ...(d.eircode ? { post_code: d.eircode } : {}), ...(d.gpName ? { gp_name: d.gpName } : {}), ...(d.heardAboutUs ? { heard_about_us: d.heardAboutUs } : {}) };
  db.patients.push(p);
  return p;
}

export function createAppointment(db: Db, now: number, a: { patientId: string; practitionerId: string; typeId: string; startsAt: string; bookingKey?: string; note?: string }): Appointment {
  const t = typeById(a.typeId)!;
  const appt: Appointment = {
    id: nextId(db), patient_id: a.patientId, practitioner_id: a.practitionerId, appointment_type_id: a.typeId, business_id: BUSINESS.id,
    starts_at: a.startsAt, ends_at: plusMinutes(a.startsAt, t.duration_in_minutes), cancelled_at: null, did_not_arrive: false, patient_arrived: false,
    notes: a.note ? [a.note] : [], bookingKey: a.bookingKey, created_at: new Date(now).toISOString(),
  };
  db.appointments.push(appt);
  return appt;
}

export const getAppointment = (db: Db, id: string) => db.appointments.find((a) => a.id === String(id));
export const findByBookingKey = (db: Db, key: string) => db.appointments.find((a) => a.bookingKey === key && !a.cancelled_at);

export function appendNote(db: Db, appointmentId: string, line: string) {
  getAppointment(db, appointmentId)?.notes.push(line);
}

export function moveAppointment(db: Db, id: string, startsAt: string) {
  const a = getAppointment(db, id);
  if (!a) return;
  const minutes = (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60_000;
  a.starts_at = startsAt;
  a.ends_at = plusMinutes(startsAt, minutes);
}

export function cancelAppointment(db: Db, now: number, id: string, note: string) {
  const a = getAppointment(db, id);
  if (!a) return;
  a.cancelled_at = new Date(now).toISOString();
  a.notes.push(note);
}
