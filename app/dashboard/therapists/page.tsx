"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { euros } from "@/core/kpi2";
import type { Measures, Scorecard, ScoreRow } from "@/demo/server/scorecard";

/**
 * Practitioner scorecard (demo): each therapist's calendar month in the measures
 * clinics commonly review with a practitioner (how full the diary was, rebooking,
 * missed appointments, new patients, visits per patient, fee per visit), set
 * against their own previous three months and common published ranges. Meant
 * for one-to-one check-ins, so it compares each person with themselves.
 */
export default function TherapistStatsPage() {
  return (
    <StaffGate permission="kpis:view" title="Therapist stats">
      {() => <Stats />}
    </StaffGate>
  );
}

const pct = (r: number | null) => (r == null ? "–" : `${Math.round(r * 100)}%`);
const num = (n: number | null) => (n == null ? "–" : String(n));
const money = (m: number | null) => (m == null ? "–" : euros(m));
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric" });
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short" });

function recentMonths(n = 6) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date());
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 15)).toISOString().slice(0, 7));
}

type Key = "howFull" | "rebooked" | "missed" | "newPatients" | "visitsPerPatient" | "feePerVisitMinor" | "perAvailableHourMinor" | "visits";
type Measure = { key: Key; label: string; show: (m: Measures) => string; higherIsBetter: boolean; range?: string; meaning: string };

const MEASURES: Measure[] = [
  { key: "visits", label: "Visits", show: (m) => num(m.visits), higherIsBetter: true, meaning: "Appointments the patient came to." },
  { key: "howFull", label: "How full", show: (m) => pct(m.howFull), higherIsBetter: true, range: "Common aim: 75–85%", meaning: "Booked time out of their working hours." },
  { key: "rebooked", label: "Rebooked", show: (m) => pct(m.rebooked), higherIsBetter: true, meaning: "Patients who left with their next visit booked." },
  { key: "missed", label: "Missed", show: (m) => pct(m.missed), higherIsBetter: false, range: "Common aim: under 10%", meaning: "No-shows and cancellations inside 24 hours." },
  { key: "newPatients", label: "New patients", show: (m) => num(m.newPatients), higherIsBetter: true, meaning: "First visits seen this month." },
  { key: "visitsPerPatient", label: "Visits / patient", show: (m) => num(m.visitsPerPatient), higherIsBetter: true, meaning: "How often each patient came, over the last 90 days." },
  { key: "feePerVisitMinor", label: "Fee per visit", show: (m) => money(m.feePerVisitMinor), higherIsBetter: true, meaning: "Average fee for a visit, at list prices." },
  { key: "perAvailableHourMinor", label: "Per hour", show: (m) => money(m.perAvailableHourMinor), higherIsBetter: true, meaning: "Fees for visits ÷ the hours they were available to see patients." },
];

/** Up, down or about the same as their usual, and whether that's good. */
function change(m: Measures, u: Measures, x: Measure) {
  const a = m[x.key];
  const b = u[x.key];
  if (a == null || b == null || (b === 0 && !["howFull", "rebooked", "missed"].includes(x.key))) return null;
  // Rates move by percentage points (3 or more counts); counts and money by 5% or more.
  const isRate = x.key === "howFull" || x.key === "rebooked" || x.key === "missed";
  const diff = isRate ? a - b : (a - b) / Math.abs(b);
  if (Math.abs(diff) < (isRate ? 0.03 : 0.05)) return { dir: "same" as const, good: null };
  const up = diff > 0;
  return { dir: up ? ("up" as const) : ("down" as const), good: up === x.higherIsBetter };
}

function Arrow({ m, u, x }: { m: Measures; u: Measures; x: Measure }) {
  const c = change(m, u, x);
  if (!c || c.dir === "same") return null;
  return (
    <span className={`kpi-change ${c.good ? "is-good" : "is-bad"}`} aria-label={`${c.dir === "up" ? "up" : "down"} on their usual`}>
      {" "}
      {c.dir === "up" ? "▲" : "▼"}
    </span>
  );
}

function Stats() {
  const months = useMemo(() => recentMonths(), []);
  const [month, setMonth] = useState(months[0]);
  const [d, setD] = useState<Scorecard | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const wanted = useRef(month);

  const load = useCallback(async (m: string) => {
    wanted.current = m;
    setError("");
    try {
      const res = await fetch(`/api/admin/therapist-stats?month=${m}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't work out the figures.");
      if (wanted.current === m) setD(json.data);
    } catch (e: any) {
      if (wanted.current === m) setError(e.message);
    }
  }, []);
  useEffect(() => {
    setD(null);
    load(month);
  }, [month, load]);

  return (
    <DashboardShell
      title="Therapist stats"
      lede="Each therapist's month next to their own usual (the three months before) and the ranges clinics commonly aim for. For one-to-one check-ins, not a league table."
    >
      <div className="stack-5 tstats">
        <div className="tstats-bar">
          <div className="field">
            <label htmlFor="ts-month">Month</label>
            <select id="ts-month" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m, i) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                  {i === 0 ? " (so far)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {!d && !error && <p className="secondary">Working out the figures…</p>}

        {d && (
          <>
            <section className="panel" aria-labelledby="ts-all">
              <h2 id="ts-all">
                {monthLabel(d.month)}: {fmtDay(d.fromDay)} – {fmtDay(d.toDay)}
                {d.soFar ? ", so far" : ""}
              </h2>
              <div className="table-wrap kpi-table-wrap">
                <table className="guide-table kpi-table">
                  <thead>
                    <tr>
                      <th scope="col">Therapist</th>
                      {MEASURES.map((x) => (
                        <th scope="col" key={x.key}>
                          {x.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.practitionerId}>
                        <th scope="row">
                          <button className="kpi-link" aria-expanded={open === r.practitionerId} aria-controls={`ts-${r.practitionerId}`} onClick={() => setOpen(open === r.practitionerId ? null : r.practitionerId)}>
                            {r.name}
                          </button>
                        </th>
                        {MEASURES.map((x) => (
                          <td className="tnum" key={x.key}>
                            {x.show(r.month)}
                            <Arrow m={r.month} u={r.usual} x={x} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="kpi-conf">▲ ▼ compare with their own usual (a change of 3 points, or 5%, or more): green is better, amber is worse. Press a name for their month and some prompts for a check-in.</p>
            </section>

            {d.rows
              .filter((r) => r.practitionerId === open)
              .map((r) => (
                <Card key={r.practitionerId} r={r} d={d} />
              ))}

            <section className="panel" aria-labelledby="ts-defs">
              <h2 id="ts-defs">How these are worked out</h2>
              <dl className="kpi-defs">
                {MEASURES.map((x) => (
                  <div key={x.key}>
                    <dt>{x.label}</dt>
                    <dd>
                      {x.meaning}
                      {x.range ? ` ${x.range}.` : ""}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt>Their usual</dt>
                  <dd>The average of the three whole months before. Holidays and new starters make a month look different, so read the arrows as a prompt to ask, not a verdict.</dd>
                </div>
                <div>
                  <dt>Where the ranges come from</dt>
                  <dd>
                    Published practice-management guidance for private physiotherapy clinics: utilisation of about 75–85% of available hours (
                    <a href="https://www.scalesuite.com.au/resources/physiotherapy-clinic-finance">Scale Suite</a>), and missed-appointment rates that clinics try to keep under 10% (NHS physiotherapy averages
                    about 1 in 10:{" "}
                    <a href="https://aocp.csp.org.uk/system/files/documents/2020-12/george_pruddens_poster.pdf">CSP poster, 2020</a>). Rebooking, new patients and visits per patient depend on the case mix, so
                    they&apos;re compared with the therapist&apos;s own past (
                    <a href="https://www.physitrack.com/en-ie/insights/physical-therapy-practice-kpis-small-clinics">Physitrack</a>).
                  </dd>
                </div>
              </dl>
            </section>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

function Card({ r, d }: { r: ScoreRow; d: Scorecard }) {
  return (
    <section className="panel tstmt" id={`ts-${r.practitionerId}`} aria-labelledby={`ts-h-${r.practitionerId}`}>
      <header className="tstmt-head">
        <div>
          <h2 id={`ts-h-${r.practitionerId}`}>{r.name}</h2>
          <p className="secondary">
            {monthLabel(d.month)}
            {d.soFar ? " so far" : ""}: {r.month.bookedHours} of {r.month.availableHours} working hours booked
          </p>
        </div>
      </header>

      <div className="tstmt-boxes score-boxes">
        {MEASURES.filter((x) => x.key !== "visits").map((x) => (
          <div className="tstmt-box score-box" key={x.key}>
            <span>{x.label}</span>
            <strong className="tnum">
              {x.show(r.month)}
              <Arrow m={r.month} u={r.usual} x={x} />
            </strong>
            <small className="secondary">
              {d.soFar && (x.key === "newPatients" || x.key === "visits") ? "Usual by now" : "Usually"} {x.show(r.usual)}
              {x.range ? ` · ${x.range.replace("Common aim: ", "aim ")}` : ""}
            </small>
          </div>
        ))}
      </div>

      <div className="kpi-action">
        <p>
          <strong>For the check-in</strong>
        </p>
        <ul className="score-prompts">
          {r.prompts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
