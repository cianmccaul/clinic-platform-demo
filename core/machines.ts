/**
 * Machines (plan 30 Oct 2026, part A). Cliniko only stops one therapist
 * being double-booked: it has no equipment, so two therapists could book the
 * shockwave or the laser for the same time. The Hub hides those times and
 * refuses them just before booking (lib/machines.ts), and the dashboard lists
 * any that got through in Cliniko itself (part B).
 *
 * A treatment that uses a machine reserves it for the whole appointment.
 * A treatment listed under both machines reserves both (Cian, 30 Oct: the
 * therapist picks on the day, so neither may be busy).
 *
 * Type ids from Cliniko's /appointment_types, matched by "shockwave" or
 * "laser" in the name on 30 Oct 2026, including the older imported types that
 * aren't booked online but can still be booked in Cliniko:
 *   shockwave: Shockwave Treatment (15mins), Physiotherapy & Shockwave (30mins),
 *     Physiotherapy & Shockwave (45mins), Physio + Shockwave (30 mins),
 *     Physio + Shockwave (45 mins), Physiotherapy + Shockwave, Shockwave
 *   laser: High Intensity Laser Therapy (20 and 45 min), Physiotherapy & High
 *     Intensity Laser (30mins, 45mins), Physio + High Intensity Laser (30 mins, 45mins)
 * No type used both on that date. A new machine treatment in Cliniko needs its id added here.
 *
 * Pure, no I/O; unit-tested in tests/machines.test.ts.
 */

export type MachineId = "shockwave" | "laser";

export const MACHINES: Record<MachineId, { label: string; capacity: number; appointmentTypeIds: readonly string[] }> = {
  shockwave: {
    label: "Shockwave",
    capacity: 1, // one machine (Cian, 30 Oct 2026)
    appointmentTypeIds: ["205"],
  },
  laser: {
    label: "Laser",
    capacity: 1, // one machine (Cian, 30 Oct 2026)
    appointmentTypeIds: ["206"],
  },
};

export const MACHINE_IDS = Object.keys(MACHINES) as MachineId[];

/** The machines this treatment needs for its whole length (none for most). */
export function machinesFor(appointmentTypeId: string, machines = MACHINES): MachineId[] {
  return (Object.keys(machines) as MachineId[]).filter((m) => machines[m].appointmentTypeIds.includes(String(appointmentTypeId)));
}

/** Longest a machine appointment is assumed to run, for reading Cliniko a little before a time. */
export const MACHINE_LOOKBACK_MS = 4 * 3_600_000;

export type MachineBooking = { id: string; appointmentTypeId: string; startMs: number; endMs: number };

const overlaps = (b: { startMs: number; endMs: number }, startMs: number, endMs: number) => b.startMs < endMs && b.endMs > startMs;

/** Most bookings using this machine at any one moment in [startMs, endMs). Back-to-back doesn't count as overlapping. */
export function peakUse(bookings: MachineBooking[], machine: MachineId, startMs: number, endMs: number, machines = MACHINES): number {
  const events: [number, number][] = [];
  for (const b of bookings) {
    if (!overlaps(b, startMs, endMs) || !machinesFor(b.appointmentTypeId, machines).includes(machine)) continue;
    events.push([Math.max(b.startMs, startMs), 1], [Math.min(b.endMs, endMs), -1]);
  }
  // Ends before starts at the same instant: 10:00-10:30 and 10:30-11:00 never meet.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let peak = 0;
  for (const [, d] of events) peak = Math.max(peak, (now += d));
  return peak;
}

/**
 * The first machine this treatment at this time would take over capacity, or
 * null if it fits. `existing` excludes the booking being made (or moved).
 */
export function machineClash(
  candidate: { appointmentTypeId: string; startMs: number; endMs: number },
  existing: MachineBooking[],
  machines = MACHINES
): MachineId | null {
  for (const m of machinesFor(candidate.appointmentTypeId, machines)) {
    if (peakUse(existing, m, candidate.startMs, candidate.endMs, machines) + 1 > machines[m].capacity) return m;
  }
  return null;
}

export type ClashGroup<B extends MachineBooking> = { machine: MachineId; startMs: number; endMs: number; bookings: B[] };

/**
 * Part B, the safety net: every stretch of time where more bookings use a
 * machine than it has room for, with the bookings involved. One group per
 * unbroken stretch, soonest first.
 */
export function findClashes<B extends MachineBooking>(bookings: B[], machines = MACHINES): ClashGroup<B>[] {
  const out: ClashGroup<B>[] = [];
  for (const machine of Object.keys(machines) as MachineId[]) {
    const using = bookings.filter((b) => b.endMs > b.startMs && machinesFor(b.appointmentTypeId, machines).includes(machine));
    const events: [number, number, B][] = [];
    for (const b of using) events.push([b.startMs, 1, b], [b.endMs, -1, b]);
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const active = new Set<B>();
    let group: ClashGroup<B> | null = null;
    for (const [at, d, b] of events) {
      if (d === 1) active.add(b);
      else active.delete(b);
      if (active.size > machines[machine].capacity) {
        group ??= { machine, startMs: at, endMs: at, bookings: [] };
        for (const x of active) if (!group.bookings.includes(x)) group.bookings.push(x);
      } else if (group) {
        group.endMs = at;
        out.push(group);
        group = null;
      }
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.machine.localeCompare(b.machine));
}
