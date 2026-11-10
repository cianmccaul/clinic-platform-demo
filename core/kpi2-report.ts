/**
 * Turns the weekly figures (core/kpi2.ts) into Insight Cards: the number,
 * how it compares with our own last 8 weeks, a 13-week trend, what it means
 * in people and euros, one thing to do, and how far to trust it. Plus the
 * "this week in one paragraph" summary, ranked by euro impact. Deterministic
 * templates only: every number in a sentence comes from the figures.
 * Unit-tested in tests/kpi2.test.ts.
 */
import {
  BASELINE_WEEKS,
  MODALITIES,
  MODALITY_LABEL,
  TREND_WEEKS,
  activeAt,
  addDays,
  attendance,
  avgFee,
  baseline,
  buildAvailability,
  confidence,
  dayParts,
  dublin,
  euros,
  feePerAttendedHour,
  forwardGaps,
  heatmap,
  hoursText,
  isNewPatientType,
  midnight,
  missedRate,
  mondayOf,
  movement,
  northStar,
  pctText,
  rebookRate,
  roughEuros,
  utilisation,
  weekStats,
  workingDaysLeftInMonth,
  type Baseline,
  type KpiInput,
  type Modality,
  type WeekStats,
} from "./kpi2.ts";

export type Dir = "up" | "down" | "normal" | "unknown";
export type Card = {
  id: string;
  label: string;
  definition: string;
  value: string;
  /** Higher is better (true), lower is better (false). */
  higherIsBetter: boolean;
  change: { dir: Dir; text: string; good: boolean | null };
  spark: (number | null)[];
  bullet?: { value: number; target?: number; low?: number; high?: number; max: number; valueLabel: string; targetLabel?: string };
  meaning: string;
  action?: { text: string; task?: { title: string; size: "S" | "M" | "L" } };
  confidence: { level: "good" | "low" | "none"; text: string };
  /** Rough euro size of what this card is about, for ranking the summary. */
  impactMinor: number;
};

export type ModalityRow = { modality: Modality; label: string; booked: number; attended: number; newPatients: number; rebook: number | null; missed: number | null; valueMinor: number; active: number };
export type TherapistRow = { id: string; booked: number; attended: number; utilisation: number | null; rebook: number | null; missed: number | null; newPatients: number; valueMinor: number; availableHours: number };

export type KpiReport = {
  computedAt: string;
  week: { from: string; to: string };
  historyWeeks: number;
  summary: string[];
  northStar: Card & { drivers: { label: string; value: string; dir: Dir; good: boolean | null }[] };
  cards: Card[];
  month: { label: string; mtdMinor: number; targetMinor: number; targetIsDefault: boolean; forecastMinor: number; workingDaysLeft: number };
  forward: { days: { day: string; emptyMin: number; availableMin: number }[]; headline: string };
  heat: { pct: (number | null)[][]; headline: string; meaning: string; slots: number };
  modalities: ModalityRow[];
  therapists: TherapistRow[];
  notes: string[];
  definitions: { label: string; text: string }[];
};

const fmtPct = (r: number | null) => pctText(r);
function change(value: number | null, b: Baseline, higherIsBetter: boolean, fmt: (n: number) => string): Card["change"] {
  const dir = movement(value, b);
  if (dir === "unknown" || !b) return { dir, text: "No comparison yet: not enough past weeks", good: null };
  if (dir === "normal") return { dir, text: `About usual (${fmt(b.mean)} over our last ${b.n} weeks)`, good: null };
  const good = (dir === "up") === higherIsBetter;
  return { dir, text: `${dir === "up" ? "Up" : "Down"} from ${fmt(b.mean)} usual (last ${b.n} weeks)`, good };
}
function conf(events: number, what: string): Card["confidence"] {
  const level = confidence(events);
  return {
    level,
    text: level === "good" ? `Reliable: based on ${events} ${what}.` : level === "low" ? `Treat as rough: only ${events} ${what}.` : `Not enough data yet: ${events} ${what}.`,
  };
}
const monthName = (day: string) => new Date(`${day.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("en-IE", { month: "long" });
const dayShort = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

export const DEFINITIONS: { label: string; text: string }[] = [
  { label: "Value of care", text: "Each attended appointment at its Cliniko price. Used instead of revenue until every online booking is invoiced in Cliniko." },
  { label: "Value per available hour (headline)", text: "Value of care ÷ therapists' available hours. It goes up when fees, fullness or attendance go up: fee per attended hour × how full the diary was × attendance." },
  { label: "Available hours", text: "Each therapist's regular hours in Cliniko, plus extra availability, minus time marked unavailable. A bank holiday with no appointments counts as closed. Therapists with no hours set in Cliniko are left out." },
  { label: "How full (utilisation)", text: "Booked time inside available hours ÷ available hours." },
  { label: "Rebooked", text: "Attended appointments where the patient's next appointment was booked by 48 hours after it ended." },
  { label: "Missed appointments", text: "Did not arrive, plus cancelled less than 24 hours before, out of the appointments that were due to happen." },
  { label: "New patients", text: "Patients who attended a \"New patient\" appointment in the week." },
  { label: "Active patients", text: "Patients seen in the last 90 days (180 days for massage and acupuncture, which are often maintenance)." },
  { label: "Usual", text: "The average of our previous 8 full weeks. A change inside normal week-to-week variation is called \"about usual\"." },
];

export function buildReport(input: KpiInput, opts: { targetMinor?: number | null } = {}): KpiReport {
  const av = buildAvailability(input);
  const today = dublin(input.nowMs).day;
  const thisMonday = mondayOf(today);
  const mondays = Array.from({ length: TREND_WEEKS }, (_, i) => addDays(thisMonday, -7 * (TREND_WEEKS - i)));
  const lastMonday = mondays[mondays.length - 1];
  const clinicWeeks = mondays.map((m) => weekStats(input, m, { kind: "clinic" }, av));
  const L = clinicWeeks[clinicWeeks.length - 1];
  const prev = clinicWeeks.slice(-1 - BASELINE_WEEKS, -1).filter((w) => w.booked + w.cancels > 0);
  const historyWeeks = clinicWeeks.filter((w) => w.booked + w.cancels > 0).length;
  const spark = (f: (w: WeekStats) => number | null) => clinicWeeks.map((w) => (w.booked + w.cancels > 0 ? f(w) : null));
  const base = (f: (w: WeekStats) => number | null) => baseline(prev.map(f));
  const fee = avgFee(L) ?? baseline(prev.map(avgFee))?.mean ?? 0;
  const valuePerBookedHour = L.bookedMin > 0 ? L.valueMinor / (L.bookedMin / 60) : feePerAttendedHour(L) ?? 0;

  // ---- North Star
  const ns = northStar(L);
  const nsBase = base(northStar);
  const driver = (label: string, f: (w: WeekStats) => number | null, fmt: (n: number) => string) => {
    const b = base(f);
    const d = movement(f(L), b);
    return { label, value: f(L) == null ? "–" : fmt(f(L)!), dir: d, good: d === "up" ? true : d === "down" ? false : null };
  };
  const drivers = [
    driver("Fee per attended hour", feePerAttendedHour, (n) => euros(n)),
    driver("How full", utilisation, (n) => fmtPct(n)),
    driver("Attendance", attendance, (n) => fmtPct(n)),
  ];
  const moved = drivers.filter((x) => x.dir === "up" || x.dir === "down");
  const northStarCard: KpiReport["northStar"] = {
    id: "north-star",
    label: "Value per available clinical hour",
    definition: DEFINITIONS[1].text,
    value: ns == null ? "–" : euros(ns),
    higherIsBetter: true,
    change: change(ns, nsBase, true, euros),
    spark: spark(northStar),
    meaning:
      ns == null
        ? "Needs therapists' working hours in Cliniko to work out."
        : `Each hour our therapists were available last week brought in about ${euros(ns)} of care. ${moved.length ? `The biggest mover: ${moved[0].label.toLowerCase()} (${moved[0].value}).` : "Fees, fullness and attendance were all about usual."}`,
    confidence: conf(L.attended, "attended appointments"),
    impactMinor: 0,
    drivers,
  };

  // ---- Month: value of care so far, target and forecast
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonth = addDays(`${today.slice(0, 7)}-28`, 4).slice(0, 7) + "-01";
  const m0 = midnight(monthStart);
  const m1 = midnight(nextMonth);
  const lastMonthStart = addDays(monthStart, -1).slice(0, 7) + "-01";
  const lm0 = midnight(lastMonthStart);
  let mtd = 0;
  let futureMinor = 0;
  let lastMonthValue = 0;
  for (const a of input.appts) {
    if (a.cancelledAt) continue;
    const t = Date.parse(a.startsAt);
    const price = a.priceMinor ?? 0;
    if (t >= m0 && t < m1) {
      if (t <= input.nowMs) {
        if (!a.didNotArrive) mtd += price;
      } else futureMinor += price;
    }
    if (t >= lm0 && t < m0 && !a.didNotArrive) lastMonthValue += price;
  }
  const attendRate = baseline(prev.map((w) => (w.booked ? w.attended / w.booked : null)))?.mean ?? 0.95;
  const forecast = Math.round(mtd + futureMinor * attendRate);
  const targetIsDefault = !(opts.targetMinor && opts.targetMinor > 0);
  const target = targetIsDefault ? Math.round(lastMonthValue * 1.1) : opts.targetMinor!;
  const wdLeft = workingDaysLeftInMonth(today);
  const gap = forecast - target;
  const revenueCard: Card = {
    id: "revenue",
    label: `Value of care, ${monthName(today)} so far`,
    definition: DEFINITIONS[0].text,
    value: euros(mtd),
    higherIsBetter: true,
    change:
      target > 0
        ? { dir: "unknown", text: `${gap >= 0 ? "On track" : "Behind"}: ${Math.round((mtd / target) * 100)}% of the ${euros(target)} target so far${targetIsDefault ? " (last month + 10%, until an owner sets one)" : ""}`, good: gap >= 0 }
        : { dir: "unknown", text: "No target yet", good: null },
    spark: spark((w) => w.valueMinor / 100),
    bullet: target > 0 ? { value: mtd, target, high: forecast, max: Math.max(target, forecast, mtd) * 1.1, valueLabel: `So far ${euros(mtd)}`, targetLabel: `Target ${euros(target)}` } : undefined,
    meaning:
      target > 0
        ? `We're at ${euros(mtd)} of ${euros(target)} with ${wdLeft} working day${wdLeft === 1 ? "" : "s"} left. Bookings already in the diary point to about ${roughEuros(forecast)}, ${gap >= 0 ? `about ${roughEuros(gap)} over target` : `about ${roughEuros(-gap)} short`}.`
        : `We're at ${euros(mtd)} so far this month.`,
    action: gap < 0 ? { text: "Fill the empty hours over the next 2 weeks (below) to close the gap.", task: { title: `Fill free slots to close a ${roughEuros(-gap)} gap this month`, size: "M" } } : undefined,
    confidence: { level: "good", text: "Uses Cliniko prices, so discounts and concessions aren't taken off yet." },
    impactMinor: Math.abs(Math.min(0, gap)),
  };

  // ---- Utilisation, forward-looking
  const gaps = forwardGaps(input, av, 14);
  const next7 = gaps.slice(0, 7);
  const avail7 = next7.reduce((s, d) => s + d.availableMin, 0);
  const booked7 = next7.reduce((s, d) => s + d.bookedMin, 0);
  const empty7 = Math.max(0, avail7 - booked7);
  const util7 = avail7 > 0 ? booked7 / avail7 : null;
  const utilBase = base(utilisation);
  const utilLast = utilisation(L);
  const emptyValue = Math.round((empty7 / 60) * valuePerBookedHour);
  const emptiestDays = [...next7].sort((a, b) => b.availableMin - b.bookedMin - (a.availableMin - a.bookedMin)).filter((d) => d.availableMin - d.bookedMin >= 60).slice(0, 2);
  const utilCard: Card = {
    id: "utilisation",
    label: "How full",
    definition: DEFINITIONS[3].text,
    value: fmtPct(utilLast),
    higherIsBetter: true,
    change: change(utilLast, utilBase, true, fmtPct),
    spark: spark(utilisation),
    bullet: utilLast != null ? { value: utilLast, low: 0.75, high: 0.85, max: 1, valueLabel: `Last week ${fmtPct(utilLast)}`, targetLabel: "75–85% is a common aim" } : undefined,
    meaning:
      util7 == null
        ? "Needs therapists' working hours in Cliniko."
        : `Next 7 days are ${fmtPct(util7)} booked so far: ${hoursText(empty7)} still free, worth about ${roughEuros(emptyValue)} if they stay empty.${emptiestDays.length ? ` Most are on ${emptiestDays.map((d) => dayShort(d.day)).join(" and ")}.` : ""}`,
    action: empty7 >= 8 * 60 ? { text: "Offer the free slots to patients due a follow-up.", task: { title: `Offer ${hoursText(empty7)} of free slots this week to patients due a follow-up`, size: "M" } } : undefined,
    confidence: { level: avail7 > 0 ? "good" : "none", text: avail7 > 0 ? `From ${hoursText(avail7)} of working hours in Cliniko.` : "No working hours set in Cliniko." },
    impactMinor: emptyValue,
  };

  // ---- Rebooking
  const rb = rebookRate(L);
  const notRebooked = L.attended - L.rebooked;
  const rebookCard: Card = {
    id: "rebooking",
    label: "Rebooked before leaving",
    definition: DEFINITIONS[4].text,
    value: confidence(L.attended) === "none" ? `${L.rebooked} of ${L.attended}` : fmtPct(rb),
    higherIsBetter: true,
    change: change(rb, base(rebookRate), true, fmtPct),
    spark: spark(rebookRate),
    meaning: `${notRebooked} of ${L.attended} patients left last week without their next visit booked. One more visit each would be at least ${roughEuros(notRebooked * fee)} of care.`,
    action: notRebooked >= 5 ? { text: "Check who left without a next visit and, where it's clinically right, invite them back.", task: { title: `Follow up ${notRebooked} patients who didn't rebook last week`, size: "M" } } : undefined,
    confidence: conf(L.attended, "attended appointments"),
    impactMinor: Math.round(notRebooked * fee * 0.5),
  };

  // ---- Missed
  const mr = missedRate(L);
  const missed = L.noShows + L.lateCancels;
  const lost = Math.max(0, L.missedValueMinor - L.feesMinor);
  const missedCard: Card = {
    id: "missed",
    label: "Missed appointments",
    definition: DEFINITIONS[5].text,
    value: confidence(L.due) === "none" ? String(missed) : fmtPct(mr),
    higherIsBetter: false,
    change: change(mr, base(missedRate), false, fmtPct),
    spark: spark(missedRate),
    meaning: `${missed} of ${L.due} appointments were missed last week (${L.noShows} didn't arrive, ${L.lateCancels} cancelled late): about ${roughEuros(lost)} not earned${L.feesMinor ? ` after ${euros(L.feesMinor)} in fees` : ""}.`,
    action: missed >= 6 ? { text: "Check reminder timing in Cliniko, and whether repeat no-shows should pay upfront.", task: { title: "Review appointment reminders and the no-show policy", size: "S" } } : undefined,
    confidence: conf(L.due, "appointments due"),
    impactMinor: lost,
  };

  // ---- New patients
  const np = L.newPatients;
  const npCard: Card = {
    id: "new-patients",
    label: "New patients",
    definition: DEFINITIONS[6].text,
    value: String(np),
    higherIsBetter: true,
    change: change(np, base((w) => w.newPatients), true, (n) => String(Math.round(n))),
    spark: spark((w) => w.newPatients),
    meaning:
      utilisation(L) != null && utilisation(L)! > 0.9
        ? `${np} new patients last week, while the diary was over 90% full: more new patients may need more hours rather than more marketing.`
        : `${np} new patients came in last week. Each one's first visits are worth about ${roughEuros(fee * 3)} if they come back twice more.`,
    confidence: conf(L.attended, "attended appointments"),
    impactMinor: 0,
  };

  // ---- Active patients
  const endLast = Math.min(midnight(thisMonday), input.nowMs);
  const nowActive = activeAt(input.appts, endLast);
  const before = activeAt(input.appts, midnight(lastMonday));
  let joinedNew = 0;
  let joinedBack = 0;
  for (const p of nowActive) {
    if (before.has(p)) continue;
    const wasNew = input.appts.some((a) => a.patientId === p && !a.cancelledAt && !a.didNotArrive && isNewPatientType(a.typeName) && Date.parse(a.startsAt) >= midnight(lastMonday) && Date.parse(a.startsAt) < endLast);
    if (wasNew) joinedNew++;
    else joinedBack++;
  }
  let lapsed = 0;
  for (const p of before) if (!nowActive.has(p)) lapsed++;
  const net = nowActive.size - before.size;
  const yearValue = fee * 4;
  const activeCard: Card = {
    id: "active",
    label: "Active patients",
    definition: DEFINITIONS[7].text,
    value: nowActive.size.toLocaleString("en-IE"),
    higherIsBetter: true,
    change: change(nowActive.size, base((w) => w.activePatients), true, (n) => Math.round(n).toLocaleString("en-IE")),
    spark: spark((w) => w.activePatients),
    meaning: `${net >= 0 ? "Up" : "Down"} ${Math.abs(net)} last week: ${joinedNew} new, ${joinedBack} came back after a break, ${lapsed} not seen for 90 days (180 for massage and acupuncture).`,
    action: lapsed >= 5 ? { text: "Send the patients who've gone quiet a friendly check-in.", task: { title: `Check in with ${lapsed} patients who've gone quiet`, size: "S" } } : undefined,
    confidence: historyWeeks >= TREND_WEEKS ? { level: "good", text: "Based on Cliniko's appointment history." } : { level: "low", text: `Only ${historyWeeks} weeks of history in Cliniko so far, so "came back" and "gone quiet" are rough.` },
    impactMinor: Math.round(lapsed * yearValue * 0.1),
  };

  const cards = [revenueCard, utilCard, rebookCard, missedCard, npCard, activeCard];

  // ---- Forward 14 days
  const forward = {
    days: gaps.map((d) => ({ day: d.day, emptyMin: Math.max(0, d.availableMin - d.bookedMin), availableMin: d.availableMin })),
    headline:
      gaps.reduce((s, d) => s + d.availableMin, 0) > 0
        ? `${hoursText(gaps.reduce((s, d) => s + Math.max(0, d.availableMin - d.bookedMin), 0))} free over the next 2 weeks, about ${roughEuros((gaps.reduce((s, d) => s + Math.max(0, d.availableMin - d.bookedMin), 0) / 60) * valuePerBookedHour)} of care if they stay empty.`
        : "Set therapists' working hours in Cliniko to see free time here.",
  };

  // ---- Busy times, last 6 weeks
  const heatWeeks = mondays.slice(-6);
  const h = heatmap(input, av, heatWeeks);
  const pctGrid = h.avail.map((row, wd) => row.map((a, hr) => (a >= 30 ? h.booked[wd][hr] / a : null)));
  const parts = dayParts(h);
  const slots = Math.round(h.avail.flat().reduce((s, x) => s + x, 0) / 60);
  let heatHeadline = "Not enough working hours in Cliniko yet to show how full each time is.";
  let heatMeaning = "";
  if (parts.length >= 2) {
    const top = parts.filter((p) => p.full >= 0.85).slice(0, 2);
    const low = [...parts].reverse().filter((p) => p.full < 0.6).slice(0, 2);
    const fullest = top.length ? top : parts.slice(0, 1);
    const quietest = low.length ? low : parts.slice(-1);
    const emptyQuiet = quietest.reduce((s, p) => s + (p.availMin - p.bookedMin), 0) / 6; // a week
    heatHeadline = `${fullest.map((p) => p.label).join(" and ")} have been ${pctText(fullest.reduce((s, p) => s + p.bookedMin, 0) / fullest.reduce((s, p) => s + p.availMin, 0))} full over the last 6 weeks, while ${quietest.map((p) => p.label).join(" and ")} sit at ${pctText(quietest.reduce((s, p) => s + p.bookedMin, 0) / quietest.reduce((s, p) => s + p.availMin, 0))}.`;
    heatMeaning = `That's about ${hoursText(emptyQuiet)} of quiet time a week, worth about ${roughEuros((emptyQuiet / 60) * valuePerBookedHour)}. If the full times keep turning patients away, moving some quiet hours into them is worth looking at; quiet times can also be offered to patients who are flexible.`;
  }

  // ---- By treatment type and therapist, last week
  const modalities: ModalityRow[] = MODALITIES.map((m) => {
    const s = weekStats(input, lastMonday, { kind: "modality", modality: m }, av);
    return { modality: m, label: MODALITY_LABEL[m], booked: s.booked, attended: s.attended, newPatients: s.newPatients, rebook: rebookRate(s), missed: missedRate(s), valueMinor: s.valueMinor, active: s.activePatients };
  }).filter((r) => r.booked + r.active > 0);
  const pracIds = new Set([...av.practitioners, ...input.appts.map((a) => a.practitionerId)]);
  const therapists: TherapistRow[] = [...pracIds]
    .map((id) => {
      const s = weekStats(input, lastMonday, { kind: "practitioner", id }, av);
      return { id, booked: s.booked, attended: s.attended, utilisation: utilisation(s), rebook: rebookRate(s), missed: missedRate(s), newPatients: s.newPatients, valueMinor: s.valueMinor, availableHours: Math.round(s.availableMin / 60) };
    })
    .filter((r) => r.booked > 0 || r.availableHours > 0)
    .sort((a, b) => b.booked - a.booked);

  // ---- Summary paragraph: the cards that matter most this week, by euro impact.
  const summary: string[] = [];
  summary.push(revenueCard.meaning);
  const ranked = [utilCard, rebookCard, missedCard, activeCard].filter((c) => c.change.dir === "down" || c.change.dir === "up" || c.impactMinor >= 20_000).sort((a, b) => b.impactMinor - a.impactMinor);
  for (const c of ranked.slice(0, 2)) summary.push(c.meaning);
  const steady = [rebookCard, missedCard].filter((c) => c.change.dir === "normal").map((c) => (c.id === "rebooking" ? "rebooking" : "missed appointments"));
  if (steady.length) summary.push(`${steady.join(" and ").replace(/^./, (x) => x.toUpperCase())}: about usual.`);
  if (summary.length === 1 && !ranked.length) summary.push("A steady week: nothing unusual.");

  const notes: string[] = [];
  const noHours = therapists.filter((t) => t.booked > 0 && t.availableHours === 0).length;
  if (noHours) notes.push(`${noHours} therapist${noHours === 1 ? " has" : "s have"} appointments but no working hours in Cliniko, so they're left out of "how full" and the headline number.`);
  if (historyWeeks < BASELINE_WEEKS + 1) notes.push(`Cliniko has ${historyWeeks} week${historyWeeks === 1 ? "" : "s"} of appointments so far; comparisons get steadier as weeks build up.`);

  return {
    computedAt: new Date(input.nowMs).toISOString(),
    week: { from: lastMonday, to: addDays(lastMonday, 6) },
    historyWeeks,
    summary: summary.slice(0, 4),
    northStar: northStarCard,
    cards,
    month: { label: monthName(today), mtdMinor: mtd, targetMinor: target, targetIsDefault, forecastMinor: forecast, workingDaysLeft: wdLeft },
    forward,
    heat: { pct: pctGrid, headline: heatHeadline, meaning: heatMeaning, slots },
    modalities,
    therapists,
    notes,
    definitions: DEFINITIONS,
  };
}
