/**
 * The dashboard areas that are view-only in the demo, with made-up sample
 * data in the same shapes as production. Changes on these pages answer
 * "not part of the demo" (see the fallback in demo/install.ts).
 */
import { EMAIL_TEMPLATES, EMAIL_TEMPLATE_IDS } from "@/core/email-templates";
import { findClashes, MACHINES } from "@/core/machines";
import { findGuide, guidesFor, resolveShots } from "@/core/guides/catalog";
import { AUDIENCE_LABEL } from "@/core/guides/types";
import { guideAudiences } from "@/core/roles";
import { addDays, dublinDay } from "@/core/policy";
import { DEFAULT_TIERS, capacityFor, monthByTherapist, paceFor, periodMonthFor, periodRange, type InvoiceIn, type TherapistRules } from "@/core/therapist-stats";
import { mondayOf } from "@/core/tasks";
import { describeRule, daysFor, type ShiftRuleInput } from "@/core/shifts";
import { BUSINESS, PRACTITIONERS, practitionerName, typeById } from "../clinic";
import { type Db, netPaidMinor, patientName } from "../db";
import { liveAppointments } from "../diary";
import { kpiAppointments } from "../kpis";
import { fail, ok, route } from "../router";

const plain = (n?: string) => (n ?? "").replace(/^\d+\.\s*/, "");
const todayOf = (now: number) => dublinDay(new Date(now).toISOString());

// ---- Machine clashes: worked out from the diary, like production

function clashes(db: Db, now: number) {
  const to = now + 7 * 86_400_000;
  const appts = liveAppointments(db)
    .filter((a) => Date.parse(a.ends_at) > now && Date.parse(a.starts_at) < to)
    .map((a) => ({ id: a.id, appointmentTypeId: a.appointment_type_id, startMs: Date.parse(a.starts_at), endMs: Date.parse(a.ends_at), a }));
  return findClashes(appts);
}

route("GET", "/api/admin/machine-clashes", (db, now, req) => {
  const groups = clashes(db, now);
  if (req.url.searchParams.get("count")) return ok({ count: groups.length });
  return ok({
    from: new Date(now).toISOString(),
    to: new Date(now + 7 * 86_400_000).toISOString(),
    clashes: groups.map((g) => ({
      machine: MACHINES[g.machine].label,
      startsAtISO: new Date(g.startMs).toISOString(),
      endsAtISO: new Date(g.endMs).toISOString(),
      appointments: g.bookings
        .sort((x, y) => x.startMs - y.startMs)
        .map(({ a }) => ({
          id: a.id, patientName: patientName(db.patients.find((p) => p.id === a.patient_id)), practitionerName: practitionerName(a.practitioner_id),
          treatment: plain(typeById(a.appointment_type_id)?.name), startsAtISO: a.starts_at, endsAtISO: a.ends_at, clinikoUrl: null,
        })),
    })),
  });
});

// ---- Not invoiced: paid online before Hub invoices started, so reception invoices them in Cliniko

route("GET", "/api/admin/uninvoiced", (db, now) => {
  const today = todayOf(now);
  const invoiced = new Set(db.invoices.map((i) => i.appointmentId));
  const rows = Object.values(db.bookings)
    .filter((b) => b.source !== "cliniko" && b.payments.length && b.startsAtISO < new Date(now).toISOString() && !invoiced.has(b.appointmentId))
    .sort((a, b) => b.startsAtISO.localeCompare(a.startsAtISO))
    .slice(0, 8)
    .map((b) => ({
      appointmentId: b.appointmentId, patientName: b.patientName ?? "", patientEmail: b.patientEmail ?? "", appointmentTypeName: plain(b.appointmentTypeName),
      practitionerName: practitionerName(b.practitionerId), startsAtISO: b.startsAtISO, status: b.status, lateCancellation: !!b.lateCancellation, netPaidMinor: netPaidMinor(b), clinikoUrl: "#",
    }));
  return ok({ from: addDays(today, -14), to: today, today, unchecked: 0, bookings: rows, hubInvoicesFrom: null });
});

// ---- Gift vouchers (sample)

function vouchers(now: number) {
  const today = todayOf(now);
  const mk = (i: number, code: string, amount: number, balance: number, buyer: string, recipient: string | null, source: "online" | "desk", daysAgo: number) => ({
    id: `v${i}`, code, status: "active" as const, source, amountMinor: amount, balanceMinor: balance, purchaseDay: addDays(today, -daysAgo), expiresOn: addDays(today, 5 * 365 - daysAgo), expired: false,
    buyerName: buyer, buyerEmail: `${buyer.split(" ")[0].toLowerCase()}@example.com`, recipientName: recipient, recipientEmail: null, message: recipient ? "Happy birthday! Enjoy." : null,
    paidBy: source === "online" ? "card online" : "card machine", paidOnline: source === "online", emailedAt: new Date(now - daysAgo * 86_400_000).toISOString(), emailError: null,
    events: [
      { id: `e${i}a`, at: new Date(now - daysAgo * 86_400_000).toISOString(), kind: "issued", amountMinor: amount, practitionerName: null, treatmentDay: null, byStaff: source === "desk" ? "Joan (Reception)" : null, note: "", undone: false, unconfirmed: false },
      ...(balance < amount ? [{ id: `e${i}b`, at: new Date(now - 3 * 86_400_000).toISOString(), kind: "redeemed", amountMinor: amount - balance, practitionerName: "Lucy Chen", treatmentDay: addDays(today, -3), byStaff: "Joan (Reception)", note: "Sports massage", undone: false, unconfirmed: false }] : []),
    ],
  });
  return [
    mk(1, "NB-7KQ4-X9TP-2HRM", 10000, 3000, "Orla Brennan", "Niamh Brennan", "online", 20),
    mk(2, "NB-3MWD-8LZC-5QAN", 7500, 7500, "Peter Walsh", null, "desk", 9),
    mk(3, "NB-9RTX-2BVE-6KJF", 15000, 15000, "Sinead Kelly", "Tom Kelly", "online", 2),
  ];
}

route("GET", "/api/admin/vouchers", (_db, now, req) => {
  const list = vouchers(now);
  const code = req.url.searchParams.get("code");
  if (code) {
    const v = list.find((x) => x.code.replace(/[^A-Z0-9]/gi, "").toUpperCase() === code.replace(/[^A-Z0-9]/gi, "").toUpperCase());
    return v ? ok({ voucher: v }) : fail(404, { error: "No voucher with that code. Try one of the sample codes, like NB-7KQ4-X9TP-2HRM." });
  }
  const today = todayOf(now);
  return ok({
    today, canManage: false, practitioners: PRACTITIONERS.map((p) => ({ id: p.id, name: practitionerName(p.id) })),
    recent: list.map((v) => ({ id: v.id, code: v.code, status: v.status, source: v.source, amountMinor: v.amountMinor, balanceMinor: v.balanceMinor, createdAt: v.events[0].at, forName: v.recipientName ?? v.buyerName, emailed: true, emailError: null })),
    outstanding: { liveCount: list.length, liveMinor: list.reduce((s, v) => s + v.balanceMinor, 0), expiredCount: 0, expiredMinor: 0 },
    period: { month: periodMonthFor(today), ...periodRange(periodMonthFor(today)), therapists: [{ practitionerId: "103", name: "Lucy Chen", amountMinor: 7000, count: 1 }] },
  });
});

// ---- Tasks (sample)

route("GET", "/api/staff/tasks", (_db, now) => {
  const today = todayOf(now);
  const people = [
    { id: "staff_demo", name: "Demo Owner" },
    { id: "staff_joan", name: "Joan" },
    { id: "staff_ruth", name: "Ruth" },
  ];
  const t = (i: number, title: string, who: number, band: "today" | "week" | "later", size: "S" | "M" | "L", done = false, priority: "normal" | "high" = "normal") => ({
    id: `t${i}`, title, notes: "", assigneeId: people[who].id, assigneeName: people[who].name, createdBy: "staff_demo", createdByName: "Demo Owner", size, priority, band, position: i,
    dueDay: band === "today" ? today : null, repeating: false, doneAt: done ? new Date(now - 3_600_000).toISOString() : null, droppedAt: null, createdAt: new Date(now - 2 * 86_400_000).toISOString(),
  });
  const tasks = [
    t(1, "Call back the three patients from the waitlist board", 0, "today", "S", false, "high"),
    t(2, "Check the shockwave machine is booked for its service", 0, "week", "M"),
    t(3, "Order more appointment cards", 0, "later", "S"),
    t(4, "Reply to the insurer about last month's receipts", 0, "today", "M", true),
  ];
  const given = [t(5, "Restock the treatment rooms", 1, "today", "S"), t(6, "Send the November rota to the therapists", 2, "week", "M")];
  return ok({
    me: { id: "staff_demo", name: "Demo Owner", manager: true }, today, monday: mondayOf(today),
    people: people.map((p, i) => ({ ...p, openPoints: [6, 1, 2][i] })), tasks, given,
    templates: [{ id: "tpl1", title: "Run the end-of-day card machine report", notes: "", assigneeId: "staff_joan", assigneeName: "Joan", size: "S", priority: "normal", rule: { kind: "weekly", weekday: 4 }, createdBy: "staff_demo" }],
    progress: { mine: { done: 1, total: 4 }, team: { done: 3, total: 9 } },
    grove: { team: [0, 1, 2, 3].map((i) => ({ week: addDays(mondayOf(today), -7 * (3 - i)), done: [7, 9, 6, 3][i], total: [9, 10, 8, 9][i] })), mine: [0, 1, 2, 3].map((i) => ({ week: addDays(mondayOf(today), -7 * (3 - i)), done: [3, 4, 2, 1][i], total: [4, 4, 3, 4][i] })) },
    treeOff: false,
  });
});

// ---- Therapist stats: worked out by the real code from the demo's appointments

const RULES: Record<string, TherapistRules> = {
  "101": { maxPatients: 150, model: "capacity", tiers: [] },
  "102": { maxPatients: 120, model: "capacity", tiers: [] },
  "103": { maxPatients: 110, model: "hybrid", tiers: [] },
  "104": { maxPatients: 140, model: "capacity", tiers: [] },
  "105": { maxPatients: null, model: "fixed", tiers: [] },
};

route("GET", "/api/admin/therapist-stats", (db, now, req) => {
  const today = todayOf(now);
  const month = req.url.searchParams.get("month") ?? periodMonthFor(today);
  const { fromDay, toDay } = periodRange(month);
  const nowIso = new Date(now).toISOString();
  const invoices: InvoiceIn[] = kpiAppointments(db, now)
    .filter((a) => !a.cancelledAt && !a.didNotArrive && a.startsAt < nowIso)
    .map((a) => ({ id: a.id, practitionerId: a.practitionerId, businessId: BUSINESS.id, issueDay: dublinDay(a.startsAt), totalMinor: a.priceMinor ?? 0, status: 20, originalInvoiceId: null, deleted: false, itemNames: [a.typeName] }));
  const byTherapist = monthByTherapist(invoices, { fromDay, toDay, businessId: BUSINESS.id });
  const rows = PRACTITIONERS.map((p) => {
    const stats = byTherapist.get(p.id) ?? { practitionerId: p.id, sessions: 0, zeroInvoices: 0, billedMinor: 0, byDay: { weekday: { sessions: 0, billedMinor: 0 }, saturday: { sessions: 0, billedMinor: 0 }, sunday: { sessions: 0, billedMinor: 0 }, bankHoliday: { sessions: 0, billedMinor: 0 } }, shockwave: 0, laser: 0 };
    const rules = RULES[p.id];
    const pace = paceFor(stats.sessions, { fromDay, toDay, today });
    return {
      practitionerId: p.id, name: practitionerName(p.id), rules, tiers: DEFAULT_TIERS, stats, capacity: capacityFor(stats.sessions, rules),
      pace, paceCapacityPct: pace != null && rules.maxPatients ? Math.round((pace / rules.maxPatients) * 1000) / 10 : null, vouchersUsed: { amountMinor: p.id === "103" ? 7000 : 0, count: p.id === "103" ? 1 : 0 },
    };
  });
  const counted = rows.reduce((s, r) => s + r.stats.sessions, 0);
  return ok({
    data: {
      month, fromDay, toDay, computedAt: new Date(now).toISOString(), today, rows,
      notes: ["Demo: worked out from the demo diary (the months before the last fortnight are made-up history)."],
      source: { invoices: counted, counted, otherBusinesses: [], noTherapist: 0, creditNotes: 0, hubReceipts: db.invoices.length },
    },
  });
});

// ---- Regular shifts (sample)

route("GET", "/api/admin/shifts", (_db, now) => {
  const today = todayOf(now);
  const rule = (id: string, r: ShiftRuleInput, createdBy: string) => {
    const days = daysFor(r.pattern, today, addDays(today, 60)).slice(0, 8);
    return { ...r, id, practitionerName: practitionerName(r.practitionerId), businessName: BUSINESS.business_name, description: describeRule(r), createdBy, createdAt: new Date(now - 20 * 86_400_000).toISOString(), days: days.map((day) => ({ day, status: "added" as const, booked: day === days[0] ? 3 : 0 })) };
  };
  return ok({
    today,
    businesses: [{ id: BUSINESS.id, name: BUSINESS.business_name }],
    practitioners: PRACTITIONERS.map((p) => ({ id: p.id, name: practitionerName(p.id), businessIds: [BUSINESS.id] })),
    rules: [
      rule("sh1", { practitionerId: "103", businessId: BUSINESS.id, start: "09:00", end: "13:00", pattern: { kind: "weeks_of_month", weekday: 6, weeks: [1, 3], fromDay: today } }, "Demo Owner"),
      rule("sh2", { practitionerId: "102", businessId: BUSINESS.id, start: "10:00", end: "14:00", pattern: { kind: "every_n_weeks", firstDay: addDays(today, (6 - new Date(now).getUTCDay() + 7) % 7 || 7), every: 2 } }, "Ruth (Owner)"),
    ],
  });
});

// ---- Emails: the real templates, nothing saved

route("GET", "/api/admin/email-templates", () => ok({ templates: EMAIL_TEMPLATE_IDS.map((id) => ({ id, ...EMAIL_TEMPLATES[id], saved: null })) }));

// ---- Team and timesheets (sample)

const TEAM = [
  { id: "staff_demo", name: "Demo Owner", email: "owner@northbank.example", role: "owner", clinikoPractitionerId: null },
  { id: "staff_ruth", name: "Ruth Doyle", email: "ruth@northbank.example", role: "owner", clinikoPractitionerId: null },
  { id: "staff_joan", name: "Joan Byrne", email: "joan@northbank.example", role: "admin", clinikoPractitionerId: null },
  { id: "staff_sarah", name: "Sarah Byrne", email: "sarah@northbank.example", role: "therapist", clinikoPractitionerId: "101" },
  { id: "staff_mark", name: "Mark Ryan", email: "mark@northbank.example", role: "therapist", clinikoPractitionerId: "102" },
  { id: "staff_lucy", name: "Lucy Chen", email: "lucy@northbank.example", role: "therapist", clinikoPractitionerId: "103" },
] as const;

route("GET", "/api/staff/team", () =>
  ok({
    me: "staff_demo", myRole: "owner",
    staff: TEAM.map((t) => ({ ...t, active: true, passkeys: t.role === "therapist" ? 1 : 2, computers: t.role === "therapist" ? 0 : 1, waitingDevices: [], timesheets: t.role !== "therapist", deviceApprover: t.id === "staff_demo" })),
  }),
);
route("GET", "/api/staff/practitioners", () => ok({ practitioners: PRACTITIONERS.map((p) => ({ id: p.id, name: practitionerName(p.id) })) }));

route("GET", "/api/staff/timesheets", (_db, now, req) => {
  const today = todayOf(now);
  const people = [{ id: "staff_demo", name: "Demo Owner" }, { id: "staff_joan", name: "Joan Byrne" }];
  const person = req.url.searchParams.get("person") ?? "staff_demo";
  const from = req.url.searchParams.get("from") ?? mondayOf(addDays(today, -7));
  const to = req.url.searchParams.get("to") ?? today;
  const entries = [];
  for (let d = from, i = 0; d <= to; d = addDays(d, 1), i++) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6 || d >= today) continue;
    for (const p of people) {
      if (person !== "all" && person !== p.id) continue;
      entries.push({ id: `ts${p.id}${d}`, userId: p.id, name: p.name, type: i === 3 && p.id === "staff_joan" ? "annual_leave" : "worked", day: d, startMin: 8 * 60 + 30 + (i % 3) * 10, endMin: 17 * 60 + (i % 2) * 15, breakMin: 30, notes: "", updatedAt: new Date(now).toISOString(), updatedByName: null });
    }
  }
  return ok({ me: { id: "staff_demo", name: "Demo Owner", enabled: true, seeAll: true }, people, person, from, to, today, entries, open: null });
});

// ---- Help guides: the demo's own guides, from the real catalogue code

route("GET", "/api/staff/guides", () => {
  const audiences = guideAudiences("owner");
  const order = [...audiences.filter((a) => a !== "patient").reverse(), "patient" as const];
  return ok({ limited: false, groups: order.map((a) => ({ audience: a, label: AUDIENCE_LABEL[a], guides: guidesFor([a]).map(({ slug, title, summary }) => ({ slug, title, summary })) })).filter((g) => g.guides.length) });
});
route("GET", "/api/staff/guides/:slug", (_db, _now, req) => {
  const guide = findGuide(req.params.slug);
  if (!guide) return fail(404, { error: "There's no guide at this address." });
  return ok({ guide, shots: resolveShots(guide) });
});
