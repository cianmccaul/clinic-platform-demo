/**
 * A believable fortnight for the fictional clinic, built around "now".
 * Deterministic for a given day. Every name and email address is made up.
 */
import type { DayPart } from "@/core/format";
import { addDays, dublinDay } from "@/core/policy";
import { REBOOK_DAYS } from "@/core/rebook";
import { formatNumber } from "@/core/hub-invoice";
import { BUSINESS, PRACTITIONERS, practitionerName, priceMinor, typeById } from "./clinic";
import { type Db, emptyDb, nextNum, randomToken } from "./db";
import { availableTimes, createAppointment, dublinTime, isFree, machineFree, plusMinutes, weekday, withinHours } from "./diary";
import { newRecord } from "./flows";
import { charge, entryFor, refundPayment } from "./stripe";
import { addEvent, createVoucher } from "./vouchers";

/** The patient to try "Manage a booking" and "Book again with your saved card" as. */
export const DEMO_PATIENT = { firstName: "Jack", lastName: "Murphy", email: "jack.murphy@example.com", phone: "087 555 0142", dob: "1991-04-17" };
/** A returning patient with no saved card: her details are on file, so she skips the details form and pays by card. */
export const RETURNING_PATIENT = { firstName: "Hannah", lastName: "Lynch", email: "hannah.lynch@example.com", phone: "086 555 0177", dob: "1986-09-02" };
/** Ids of the three seeded gift vouchers: part used, unused, and bought as a gift. */
export const DEMO_VOUCHER_IDS = { partUsed: "v-demo-1", unused: "v-demo-2", gift: "v-demo-3" };

const NAMES = [
  "Emma Nolan", "Liam O'Brien", "Grace Kinsella", "Daniel Farrell", "Sophie Walsh", "Aoife Brennan", "Conor Walsh", "Niamh Kelly",
  "Eoin Byrne", "Ciara Ryan", "Seán Doyle", "Orla Hayes", "Ruairí Daly", "Saoirse Quinn", "Darragh Moran", "Fiona Gallagher",
  "Patrick Dunne", "Mary Keane", "Kevin Moran", "Laura Healy", "Shane Power", "Ella Dolan", "Fionn Burke", "Clodagh Reilly",
  "Brian Nash", "Megan Tierney", "Oisín Flood", "Rachel Coyle", "Adam Furlong", "Katie Lennon", "Declan Farrell", "Aisling Fox",
];

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedDb(now: number): Db {
  const today = dublinDay(new Date(now).toISOString());
  const db = emptyDb(today);
  const rand = rng(Number(today.replace(/-/g, "")));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const past = (t: number) => Math.min(t, now - 60_000);
  const nowIso = new Date(now).toISOString();

  const patients = NAMES.map((n, i) => {
    const [first, ...rest] = n.split(" ");
    const last = rest.join(" ");
    const slug = `${first}.${last}`.toLowerCase().normalize("NFD").replace(/[^a-z.]/g, "");
    const p = {
      id: String(2_000_000 + i), first_name: first, last_name: last, email: `${slug}@example.com`,
      phone: `08${1 + Math.floor(rand() * 8)} 555 0${100 + Math.floor(rand() * 899)}`,
      date_of_birth: `19${50 + Math.floor(rand() * 50)}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`,
      created_at: new Date(now - (30 + rand() * 600) * 86_400_000).toISOString(),
    };
    db.patients.push(p);
    return p;
  });

  for (let d = -13; d <= 12; d++) {
    const day = addDays(today, d);
    for (const pr of PRACTITIONERS) {
      const hours = pr.hours[weekday(day)];
      if (!hours) continue;
      const close = dublinTime(day, hours[1]);
      const fill = d < 0 ? 0.8 : d === 0 ? 0.75 : Math.max(0.18, 0.62 - d * 0.035);
      let start = dublinTime(day, hours[0]);
      while (plusMinutes(start, 30) <= close) {
        let typeId = pick(pr.offers.flatMap((o) => (o === "202" || o === "204" ? [o, o, o] : [o])));
        // One shockwave machine, one laser: the Hub never double-books them.
        if (!machineFree(db, typeId, start, plusMinutes(start, typeById(typeId)!.duration_in_minutes))) typeId = "202";
        const t = typeById(typeId)!;
        const end = plusMinutes(start, t.duration_in_minutes);
        if (end > close || rand() > fill) {
          start = plusMinutes(start, 30);
          continue;
        }
        const patient = pick(patients);
        const isPast = start < nowIso;
        // Every roll is drawn up front, so the same day seeds the same clinic whatever the time of day.
        const roll = { noShow: rand(), online: rand(), booked: rand(), brand: rand(), last4: rand(), extra: rand(), cancelled: rand(), machine: rand() };
        const appt = createAppointment(db, past(new Date(start).getTime() - 3 * 86_400_000), { patientId: patient.id, practitionerId: pr.id, typeId, startsAt: start });
        if (isPast) {
          if (roll.noShow < 0.05) appt.did_not_arrive = true;
          else appt.patient_arrived = true;
        }
        const online = pr.id !== "105" && roll.online < 0.82;
        if (online) {
          const bookedAt = isPast ? new Date(start).getTime() - (1 + roll.booked * 12) * 86_400_000 : now - roll.booked * 8 * 86_400_000;
          const pi = charge(db, past(bookedAt), { practitionerId: pr.id, amountMinor: priceMinor(typeId), description: t.name, patientId: patient.id, card: { brand: ["visa", "mastercard", "visa"][Math.floor(roll.brand * 3)], last4: String(1000 + Math.floor(roll.last4 * 8999)) } });
          const rec = newRecord(appt, patient, past(bookedAt));
          rec.payments.push(entryFor(pi, "full"));
          db.bookings[appt.id] = rec;
          db.savedCards[patient.id] = { ...pi.card, account: pi.account };
          if (appt.patient_arrived && (typeId === "202" || typeId === "201") && roll.extra < 0.08) {
            const extra = charge(db, past(new Date(end).getTime()), { practitionerId: pr.id, amountMinor: 3000, description: "Extra treatment", patientId: patient.id, card: pi.card });
            rec.payments.push(entryFor(extra, "extra", "Shockwave"));
          }
          // A few cancelled in good time and refunded.
          if (roll.cancelled < 0.06) {
            const at = past(bookedAt + 86_400_000);
            if (new Date(start).getTime() - at > 24 * 3_600_000) {
              const r = refundPayment(db, at, pi.id, pi.amount, "Cancelled in good time", "patient");
              rec.payments[0].refundedMinor = r;
              Object.assign(rec, { status: "cancelled", cancelledAt: new Date(at).toISOString(), cancelledBy: "patient" });
              appt.cancelled_at = new Date(at).toISOString();
            }
          }
        } else if (appt.patient_arrived && roll.machine < 0.7) {
          // Booked by phone, paid on the card machine afterwards.
          const pi = charge(db, past(new Date(end).getTime()), { practitionerId: pr.id, amountMinor: priceMinor(typeId), description: `${t.name} (card machine)`, patientId: patient.id, card: { brand: "visa", last4: "0019" } });
          const rec = newRecord(appt, patient, past(new Date(end).getTime()), "cliniko");
          rec.payments.push(entryFor(pi, "full"));
          db.bookings[appt.id] = rec;
        }
        start = end;
      }
    }
  }
  // One machine clash made straight in Cliniko (the Hub would have refused it), for the Machine clashes page:
  // Sarah and Tom both down for shockwave at the same time, a few days out.
  clash: for (let d = 2; d <= 6; d++) {
    for (const hhmm of ["10:00", "11:00", "14:00", "12:00", "15:00", "09:00"]) {
      const s = dublinTime(addDays(today, d), hhmm);
      const e = plusMinutes(s, typeById("205")!.duration_in_minutes);
      if (!["101", "104"].every((id) => withinHours(id, s, e) && isFree(db, id, s, e, now)) || !machineFree(db, "205", s, e)) continue;
      createAppointment(db, past(now - 2 * 86_400_000), { patientId: pick(patients).id, practitionerId: "101", typeId: "205", startsAt: s });
      createAppointment(db, past(now - 86_400_000), { patientId: pick(patients).id, practitionerId: "104", typeId: "205", startsAt: s, note: "Booked in Cliniko" });
      break clash;
    }
  }


  // Jack: one booking more than 24 hours away (free to change) and one inside 24 hours (the fee applies).
  const jack = { id: "2009999", first_name: DEMO_PATIENT.firstName, last_name: DEMO_PATIENT.lastName, email: DEMO_PATIENT.email, phone: DEMO_PATIENT.phone, date_of_birth: DEMO_PATIENT.dob, address_1: "14 Quay Street", state: "Dublin", post_code: "D01 X2Y3", gp_name: "Dr Nolan, Northside Medical", created_at: new Date(now - 200 * 86_400_000).toISOString() };
  db.patients.push(jack);
  const soon = PRACTITIONERS.filter((p) => p.id !== "105")
    .flatMap((p) => availableTimes(db, p.id, "202", today, addDays(today, 1), now).map((t) => ({ p, t })))
    .filter(({ t }) => new Date(t).getTime() - now > 3 * 3_600_000 && new Date(t).getTime() - now < 22 * 3_600_000)
    .sort((a, b) => a.t.localeCompare(b.t))[0];
  const later = availableTimes(db, "101", "202", addDays(today, 3), addDays(today, 10), now)[1];
  for (const slot of [soon && { pid: soon.p.id, t: soon.t }, later && { pid: "101", t: later }]) {
    if (!slot) continue;
    const appt = createAppointment(db, now - 5 * 86_400_000, { patientId: jack.id, practitionerId: slot.pid, typeId: "202", startsAt: slot.t });
    const pi = charge(db, now - 5 * 86_400_000, { practitionerId: slot.pid, amountMinor: priceMinor("202"), description: typeById("202")!.name, patientId: jack.id, card: { brand: "visa", last4: "4242" } });
    const rec = newRecord(appt, jack, now - 5 * 86_400_000);
    rec.payments.push(entryFor(pi, "full"));
    db.bookings[appt.id] = rec;
  }
  db.savedCards[jack.id] = { brand: "visa", last4: "4242", account: "acct_demo_sarah" };

  // Jack's history, for "Past payments" on Manage a booking: two visits (one with an extra agreed on the day),
  // and one he cancelled in good time and was refunded for.
  /** Make room in the past diary for a named demo visit, so no therapist is ever shown double-booked. */
  const clear = (pid: string, startsAt: string, minutes: number) => {
    const endsAt = plusMinutes(startsAt, minutes);
    const gone = db.appointments.filter((a) => a.practitioner_id === pid && a.starts_at < endsAt && startsAt < a.ends_at);
    for (const a of gone) {
      const ids = new Set((db.bookings[a.id]?.payments ?? []).map((p) => p.paymentIntentId));
      db.payments = db.payments.filter((p) => !ids.has(p.id));
      db.refunds = db.refunds.filter((r) => !ids.has(r.payment_intent));
      delete db.bookings[a.id];
    }
    db.appointments = db.appointments.filter((a) => !gone.includes(a));
  };
  const jackVisit = (daysAgo: number, pid: string, typeId: string, o: { extra?: boolean; cancelled?: boolean } = {}) => {
    const day = addDays(today, -daysAgo);
    const hours = PRACTITIONERS.find((p) => p.id === pid)!.hours[weekday(day)];
    if (!hours) return;
    const startsAt = dublinTime(day, hours[0]);
    const bookedAt = new Date(startsAt).getTime() - 4 * 86_400_000;
    clear(pid, startsAt, typeById(typeId)!.duration_in_minutes);
    const appt = createAppointment(db, bookedAt, { patientId: jack.id, practitionerId: pid, typeId, startsAt });
    const pi = charge(db, bookedAt, { practitionerId: pid, amountMinor: priceMinor(typeId), description: typeById(typeId)!.name, patientId: jack.id, card: { brand: "visa", last4: "4242" } });
    const rec = newRecord(appt, jack, bookedAt);
    rec.payments.push(entryFor(pi, "full"));
    db.bookings[appt.id] = rec;
    if (o.cancelled) {
      const at = bookedAt + 86_400_000;
      rec.payments[0].refundedMinor = refundPayment(db, at, pi.id, pi.amount, "Cancelled in good time", "patient");
      Object.assign(rec, { status: "cancelled", cancelledAt: new Date(at).toISOString(), cancelledBy: "patient" });
      appt.cancelled_at = new Date(at).toISOString();
      return;
    }
    appt.patient_arrived = true;
    if (o.extra) {
      const extra = charge(db, new Date(appt.ends_at).getTime(), { practitionerId: pid, amountMinor: 3000, description: "Extra treatment", patientId: jack.id, card: { brand: "visa", last4: "4242" } });
      rec.payments.push(entryFor(extra, "extra", "Shockwave"));
    }
  };
  // 14 to 18 days back there's always a day Sarah works; the offsets differ so no two land on the same morning.
  const sarahDay = (from: number) => [0, 1, 2, 3, 4, 5, 6].map((i) => from + i).find((d) => PRACTITIONERS[0].hours[weekday(addDays(today, -d))])!;
  jackVisit(sarahDay(35), "101", "201");
  jackVisit(sarahDay(21), "101", "202", { extra: true });
  jackVisit(sarahDay(14), "101", "202", { cancelled: true });

  // Hannah: seen twice, paid on the card machine each time, so there's no saved card. Her details are on file.
  const hannah = { id: "2009998", first_name: RETURNING_PATIENT.firstName, last_name: RETURNING_PATIENT.lastName, email: RETURNING_PATIENT.email, phone: RETURNING_PATIENT.phone, date_of_birth: RETURNING_PATIENT.dob, address_1: "3 Mill Lane", state: "Dublin", post_code: "D07 K4N8", gp_name: "Dr Byrne, Riverside Practice", created_at: new Date(now - 320 * 86_400_000).toISOString() };
  db.patients.push(hannah);
  for (const from of [42, 28]) {
    const d = [0, 1, 2, 3, 4, 5, 6].map((i) => from + i).find((x) => PRACTITIONERS[1].hours[weekday(addDays(today, -x))])!;
    const startsAt = plusMinutes(dublinTime(addDays(today, -d), PRACTITIONERS[1].hours[weekday(addDays(today, -d))]![0]), 60);
    clear("102", startsAt, typeById("202")!.duration_in_minutes);
    const appt = createAppointment(db, new Date(startsAt).getTime() - 2 * 86_400_000, { patientId: hannah.id, practitionerId: "102", typeId: "202", startsAt });
    appt.patient_arrived = true;
    const pi = charge(db, new Date(appt.ends_at).getTime(), { practitionerId: "102", amountMinor: priceMinor("202"), description: `${typeById("202")!.name} (card machine)`, patientId: hannah.id, card: { brand: "visa", last4: "0019" } });
    const rec = newRecord(appt, hannah, new Date(appt.ends_at).getTime(), "cliniko");
    rec.payments.push(entryFor(pi, "full"));
    db.bookings[appt.id] = rec;
  }

  // Gift vouchers: one part used at the desk, one unused, one bought online as a gift. Their own random
  // source, so adding them never changes the rest of the seeded clinic.
  const vrand = rng(Number(today.replace(/-/g, "")) + 7);
  const mkVoucher = (id: string, amountMinor: number, buyer: string, recipient: string | null, source: "online" | "desk", daysAgo: number) => {
    const v = createVoucher(db, now, { rand: vrand, daysAgo, source, amountMinor, buyerName: buyer, buyerEmail: `${buyer.split(" ")[0].toLowerCase()}@example.com`, recipientName: recipient, recipientEmail: null, message: recipient ? "Happy birthday! Enjoy." : null });
    v.id = id;
    v.emailedAt = new Date(now - daysAgo * 86_400_000).toISOString();
    return v;
  };
  const used = mkVoucher(DEMO_VOUCHER_IDS.partUsed, 10000, "Orla Brennan", "Niamh Brennan", "online", 20);
  addEvent(db, now - 3 * 86_400_000, used, { kind: "redeemed", amountMinor: -7000, practitionerId: "103", treatmentDay: addDays(today, -3), byStaff: "Joan (Reception)", note: "Sports massage" });
  mkVoucher(DEMO_VOUCHER_IDS.unused, 7500, "Peter Walsh", null, "desk", 9);
  mkVoucher(DEMO_VOUCHER_IDS.gift, 15000, "Sinead Kelly", "Tom Kelly", "online", 2);

  // A patient whose time went while they paid yesterday: payment kept, waiting to pick a new time.
  const laura = patients.find((p) => p.last_name === "Healy")!;
  const lauraPaid = charge(db, now - 26 * 3_600_000, { practitionerId: "102", amountMinor: priceMinor("201"), description: typeById("201")!.name, patientId: laura.id, card: { brand: "mastercard", last4: "5531" } });
  db.rebooks.push({
    id: `rb${nextNum(db)}`, token: randomToken(), status: "open", createdAt: new Date(now - 26 * 3_600_000).toISOString(),
    refundBy: new Date(now - 26 * 3_600_000 + REBOOK_DAYS * 86_400_000).toISOString(), sessionId: "cs_test_seed",
    patient: { firstName: laura.first_name, lastName: laura.last_name, email: laura.email }, clinikoPatientId: laura.id,
    practitionerId: "102", practitionerName: practitionerName("102"), appointmentTypeId: "201", appointmentTypeName: typeById("201")!.name,
    businessId: "1", originalStartsAtISO: dublinTime(addDays(today, 2), "13:00"), amountMinor: lauraPaid.amount, paymentIntentId: lauraPaid.id,
  });

  // The waitlist: people hoping for an earlier time.
  const wl = (i: number, typeId: string, practitionerId: string, days: number[], parts: string[], addedBy?: string) => {
    const p = patients[i];
    db.waitlist.push({
      id: `wl${nextNum(db)}`, leaveToken: `leave${nextNum(db)}${i}`, status: "active", createdAt: new Date(now - (2 + (i % 4)) * 86_400_000).toISOString(),
      patient: { firstName: p.first_name, lastName: p.last_name, email: p.email, phone: p.phone }, wantsSms: true,
      appointmentTypeId: typeId, appointmentTypeName: typeById(typeId)!.name, businessId: BUSINESS.id, practitionerId,
      fromDay: today, untilDay: addDays(today, 21), days, parts: parts as DayPart[], offerLog: [], ignoredInRow: 0, ...(addedBy ? { addedBy } : {}),
    });
  };
  wl(3, "202", "101", [1, 2, 4], ["Morning"]);
  wl(8, "203", "any", [2, 3, 5], ["Afternoon", "Evening"], "Joan (Reception)");
  wl(14, "201", "104", [3, 4], ["Morning", "Afternoon"]);

  // Invoices the platform emailed for recent paid visits.
  let n = 1240;
  for (const rec of Object.values(db.bookings).filter((b) => b.status === "booked" && b.startsAtISO < nowIso && b.payments.length).slice(-14)) {
    db.invoices.push({
      id: `inv${nextNum(db)}`, number: formatNumber(++n), kind: "invoice", appointmentId: rec.appointmentId, patientName: rec.patientName ?? "", email: rec.patientEmail ?? "",
      practitionerId: rec.practitionerId, amountMinor: rec.payments.reduce((s, p) => s + p.amountMinor - p.refundedMinor, 0), issuedAt: plusMinutes(rec.startsAtISO, 90),
      lines: rec.payments.map((p) => ({ label: p.kind === "extra" ? p.label ?? "Extra treatment" : (rec.appointmentTypeName ?? "Appointment").replace(/ - .*$/, ""), amountMinor: p.amountMinor - p.refundedMinor })),
    });
  }

  db.audit = [];
  db.outbox = [];
  return db;
}
