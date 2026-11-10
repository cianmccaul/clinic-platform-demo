"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { euros } from "@/core/kpi2";
import { DEFAULT_TIERS, DAY_KINDS, maxPatientsFromHours, periodMonthFor, periodRange, tierProblem, type DayKind, type RentModel, type Tier } from "@/core/therapist-stats";
import type { TherapistReport, TherapistRow } from "@/lib/therapist-stats";

/**
 * Therapist stats (Cian, 27 Oct 2026): each therapist's rent period (29th to 28th)
 * in the figures the room-rentals tool works from, read from Cliniko invoices and
 * laid out like its Statement of Earnings: capacity, revenue breakdown, tier table,
 * machine sessions. Owners and super admins only. Stats only: no rent amounts.
 */
export default function TherapistStatsPage() {
  return (
    <StaffGate permission="kpis:view" title="Therapist stats">
      {() => <Stats />}
    </StaffGate>
  );
}

const DAY_LABEL: Record<DayKind, string> = { weekday: "Weekdays", saturday: "Saturdays", sunday: "Sundays", bankHoliday: "Bank holidays" };
const MODEL_LABEL: Record<RentModel, string> = { capacity: "Capacity tiers", hybrid: "Hybrid (tiers on weekdays)", fixed: "Fixed amount or flat % (no capacity)" };
const MODEL_BADGE: Record<RentModel, string> = { capacity: "Revenue share", hybrid: "Hybrid", fixed: "Fixed / flat rate" };
const pct1 = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
const ratePct = (f: number) => `${Math.round(f * 1000) / 10}%`;
const band = (t: Tier, last: boolean) => (last ? `${t.min}%+` : `${t.min}–${t.max}%`);
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric" });
const periodText = (m: string) => {
  const r = periodRange(m);
  return `${fmtDay(r.fromDay)} – ${fmtDay(r.toDay)}`;
};

/** The running period and the 11 before it ("2026-10" = 29 Sep – 28 Oct). */
function recentPeriods(n = 12) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m] = periodMonthFor(today).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 15)).toISOString().slice(0, 7));
}

async function call(method: "GET" | "POST", body?: unknown, month?: string) {
  const url = method === "GET" ? `/api/admin/therapist-stats?month=${month}` : "/api/admin/therapist-stats";
  const res = await fetch(url, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
  return json;
}

function Stats() {
  const months = useMemo(() => recentPeriods(), []);
  const [month, setMonth] = useState(months[0]);
  const [d, setD] = useState<TherapistReport | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const wanted = useRef(month);

  const load = useCallback(async (m: string, refresh = false) => {
    wanted.current = m;
    setBusy(true);
    setError("");
    try {
      const j = refresh ? await call("POST", { action: "refresh", month: m }) : await call("GET", undefined, m);
      if (wanted.current !== m) return; // another period was picked meanwhile
      setD(j.data);
    } catch (e: any) {
      if (wanted.current === m) setError(e.message);
    } finally {
      if (wanted.current === m) setBusy(false);
    }
  }, []);
  useEffect(() => {
    setD(null);
    load(month);
  }, [month, load]);

  const isCurrent = month === months[0];
  const src = d?.source;

  return (
    <DashboardShell
      title="Therapist stats"
      lede="Each therapist's rent period (29th to 28th) from Cliniko invoices, laid out like their statement: how full they were, what was billed, and which tier that puts them in. Owners and super admins only."
    >
      <div className="stack-5 tstats">
        <div className="tstats-bar">
          <div className="field">
            <label htmlFor="ts-month">Period</label>
            <select id="ts-month" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m, i) => (
                <option key={m} value={m}>
                  {monthLabel(m)}: {periodText(m)}
                  {i === 0 ? " (so far)" : ""}
                </option>
              ))}
            </select>
          </div>
          {d && (
            <p className="kpi-updated">
              Worked out {fmtWhen(d.computedAt)} ·{" "}
              <button className="kpi-link" disabled={busy} onClick={() => load(month, true)}>
                {busy ? "Refreshing…" : "Refresh now"}
              </button>
            </p>
          )}
        </div>

        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {notice && (
          <Notice tone="success">
            <p>{notice}</p>
          </Notice>
        )}

        {!d && !error && <p className="secondary">Reading this period&apos;s invoices from Cliniko. This can take up to a minute…</p>}

        {d && src && (
          <>
            {src.counted === 0 && !src.hubReceipts && (
              <Notice title="No sessions found in Cliniko for this period">
                <p>
                  Cliniko has {src.invoices} invoice{src.invoices === 1 ? "" : "s"} dated {fmtDay(d.fromDay)} to {fmtDay(d.toDay)}
                  {src.otherBusinesses.length ? `, of which ${src.otherBusinesses.map((b) => `${b.invoices} ${b.invoices === 1 ? "is" : "are"} in ${b.name}`).join(" and ")} (not counted here)` : ""}
                  {src.noTherapist ? `, and ${src.noTherapist} with no therapist on them` : ""}.
                  {src.invoices === 0 ? " Therapists' sessions only show here once they're invoiced in Cliniko." : ""}
                </p>
              </Notice>
            )}
            {d.notes.length > 0 && (
              <Notice title="Worth knowing">
                {d.notes.map((n) => (
                  <p key={n}>{n}</p>
                ))}
              </Notice>
            )}

            <section className="panel" aria-labelledby="ts-all">
              <h2 id="ts-all">
                {monthLabel(d.month)}: {fmtDay(d.fromDay)} – {fmtDay(d.toDay)}
                {isCurrent ? ", so far" : ""}
              </h2>
              {d.rows.length === 0 ? (
                <p className="secondary">No therapists with rules or invoices for this period.</p>
              ) : (
                <div className="table-wrap kpi-table-wrap">
                  <table className="guide-table kpi-table">
                    <thead>
                      <tr>
                        <th scope="col">Therapist</th>
                        <th scope="col">Patients</th>
                        <th scope="col">Max</th>
                        <th scope="col">How full</th>
                        <th scope="col">Tier</th>
                        <th scope="col">To next tier</th>
                        <th scope="col">Billed</th>
                        {isCurrent && <th scope="col">On pace for</th>}
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
                          <td className="tnum">{r.stats.sessions}</td>
                          <td className="tnum">{r.rules.model === "fixed" ? "–" : r.rules.maxPatients ?? "not set"}</td>
                          <td className="tnum">{r.capacity ? pct1(r.capacity.pct) : "–"}</td>
                          <td>{r.capacity ? `${band(r.capacity.tier, r.capacity.tierIndex === r.tiers.length - 1)} · ${ratePct(r.capacity.tier.pct)}` : r.rules.model === "fixed" ? "Fixed" : "–"}</td>
                          <td className="tnum">{r.capacity ? (r.capacity.toNextTier == null ? "Top tier" : `${r.capacity.toNextTier} more`) : "–"}</td>
                          <td className="tnum">{euros(r.stats.billedMinor)}</td>
                          {isCurrent && <td className="tnum">{r.pace == null ? "–" : `${r.pace}${r.paceCapacityPct != null ? ` (${pct1(r.paceCapacityPct)})` : ""}`}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="kpi-conf">Press a name for their statement and rules.{isCurrent ? " On pace for is rough: patients so far, scaled by working days (Mon–Sat) left in the period." : ""}</p>
            </section>

            {d.rows
              .filter((r) => r.practitionerId === open)
              .map((r) => (
                <Statement
                  key={`${r.practitionerId}:${r.rules.updatedAt ?? ""}`}
                  r={r}
                  d={d}
                  isCurrent={isCurrent}
                  onSaved={async (msg) => {
                    setNotice(msg);
                    await load(month);
                  }}
                  onError={setError}
                />
              ))}

            <section className="panel" aria-labelledby="ts-defs">
              <h2 id="ts-defs">How these are worked out</h2>
              <ul className="kpi-defs">
                <li><strong>Period:</strong> the 29th of the month before to the 28th, as on the statements.</li>
                <li><strong>Patients (sessions):</strong> invoices in Cliniko dated in the period with an amount billed, paid or not, plus the Hub&apos;s own receipts for online payments (by date of treatment, less refunds). Late-cancel and no-show fees count once anything was billed, as in the room-rentals tool. Invoices for €0 aren&apos;t counted; they&apos;re listed so you can check them.</li>
                <li><strong>Credit notes:</strong> take their amount off the invoice they reverse. A fully reversed invoice isn&apos;t a session.</li>
                <li><strong>How full:</strong> patients ÷ max capacity. Reaching a tier&apos;s top moves you into the next one (70.0% is in 70–80%).</li>
                <li><strong>Billed:</strong> invoice totals by the invoice&apos;s date: weekday, Saturday, Sunday or Irish bank holiday. (The room-rentals tool counts bank holidays as weekdays, except for hybrid therapists on the dates they list.)</li>
                <li><strong>Shockwave and laser:</strong> sessions with an invoice item named like that.</li>
                <li>Only the clinic&apos;s own Cliniko business counts. Figures update every hour for the running period, daily for earlier ones, or when you press Refresh.</li>
              </ul>
              <p className="kpi-conf">
                From Cliniko: {src.invoices} invoices in the period, {src.counted} counted as sessions
                {src.creditNotes ? `, ${src.creditNotes} credit notes` : ""}
                {src.otherBusinesses.length ? `, ${src.otherBusinesses.map((b) => `${b.invoices} in ${b.name}`).join(", ")} left out` : ""}
                {src.noTherapist ? `, ${src.noTherapist} with no therapist` : ""}
                {src.hubReceipts ? `; plus ${src.hubReceipts} Hub receipt${src.hubReceipts === 1 ? "" : "s"} for online payments` : ""}.
              </p>
            </section>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

/** One therapist's period, laid out like their Statement of Earnings (stats only, no rent amounts). */
function Statement({ r, d, isCurrent, onSaved, onError }: { r: TherapistRow; d: TherapistReport; isCurrent: boolean; onSaved: (msg: string) => Promise<void>; onError: (m: string) => void }) {
  const s = r.stats;
  const cap = r.capacity;
  const days = DAY_KINDS.filter((k) => k !== "bankHoliday" || s.byDay.bankHoliday.sessions > 0);
  return (
    <section className="panel tstmt" id={`ts-${r.practitionerId}`} aria-labelledby={`ts-h-${r.practitionerId}`}>
      <header className="tstmt-head">
        <div>
          <h2 id={`ts-h-${r.practitionerId}`}>{r.name}</h2>
          <p className="secondary">
            {fmtDay(d.fromDay)} – {fmtDay(d.toDay)}
            {isCurrent ? " (so far)" : ""}
          </p>
        </div>
        <span className="tstmt-badge">{MODEL_BADGE[r.rules.model]}</span>
      </header>

      {cap && (
        <div className="tstmt-block">
          <h3 className="tstmt-label">Clinic capacity</h3>
          <div className="tstmt-boxes">
            <div className="tstmt-box">
              <span>Number of patients</span>
              <strong className="tnum">{s.sessions}</strong>
            </div>
            <div className="tstmt-box">
              <span>Max capacity</span>
              <strong className="tnum">{r.rules.maxPatients}</strong>
            </div>
            <div className="tstmt-box">
              <span>Capacity percentage</span>
              <strong className="tnum">{pct1(cap.pct)}</strong>
            </div>
          </div>
          <div className="tstat-meter" role="img" aria-label={`${pct1(cap.pct)} of max capacity`}>
            <span style={{ width: `${Math.min(100, cap.pct)}%` }} />
          </div>
          <p className="secondary">
            {cap.toNextTier == null ? "In the top tier." : `${cap.toNextTier} more patient${cap.toNextTier === 1 ? "" : "s"} to reach ${r.tiers[cap.tierIndex + 1].min}% and the next tier.`}
            {isCurrent && r.pace != null ? ` On pace for about ${r.pace}${r.paceCapacityPct != null ? ` (${pct1(r.paceCapacityPct)})` : ""} by ${fmtDay(d.toDay)}.` : ""}
          </p>
        </div>
      )}
      {!cap && r.rules.model !== "fixed" && <Notice title="No max capacity set"><p>Set their max patients under Change rules to see how full they were.</p></Notice>}

      <div className="tstmt-block">
        <h3 className="tstmt-label">Revenue breakdown</h3>
        <div className="table-wrap kpi-table-wrap">
          <table className="guide-table kpi-table tstmt-table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Patients</th>
                <th scope="col">Total billed</th>
              </tr>
            </thead>
            <tbody>
              {days.map((k) => (
                <tr key={k}>
                  <th scope="row">{DAY_LABEL[k]}</th>
                  <td className="tnum">{s.byDay[k].sessions}</td>
                  <td className="tnum">{euros(s.byDay[k].billedMinor)}</td>
                </tr>
              ))}
              <tr className="tstmt-total">
                <th scope="row">Total</th>
                <td className="tnum">{s.sessions}</td>
                <td className="tnum">{euros(s.billedMinor)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {s.zeroInvoices > 0 && <p className="secondary">Also {s.zeroInvoices} invoice{s.zeroInvoices === 1 ? "" : "s"} for €0, not counted.</p>}
      </div>

      {r.rules.model !== "fixed" && (
        <div className="tstmt-block">
          <h3 className="tstmt-label">Tier table</h3>
          <ol className="tstmt-tiers">
            {r.tiers.map((t, i) => {
              const here = cap?.tierIndex === i;
              return (
                <li key={i} className={here ? "is-here" : undefined} aria-current={here ? "true" : undefined}>
                  <span className="tnum">
                    {band(t, i === r.tiers.length - 1)}
                    {here ? <span className="visually-hidden"> (this period)</span> : null}
                  </span>
                  <span className="tnum">{ratePct(t.pct)} rent</span>
                </li>
              );
            })}
          </ol>
          <p className="secondary tstmt-note">Saturday, Sunday and bank holiday rent use fixed rates and aren&apos;t affected by the tiers.</p>
        </div>
      )}

      {r.vouchersUsed !== undefined && (
        <div className="tstmt-block">
          <h3 className="tstmt-label">Gift vouchers used</h3>
          {r.vouchersUsed == null ? (
            <p className="secondary">Couldn&apos;t read the gift vouchers just now. Press Refresh now to try again.</p>
          ) : (
            <>
              <div className="tstmt-boxes is-two">
                <div className="tstmt-box">
                  <span>Treatments</span>
                  <strong className="tnum">{r.vouchersUsed.count}</strong>
                </div>
                <div className="tstmt-box">
                  <span>Amount</span>
                  <strong className="tnum">{euros(r.vouchersUsed.amountMinor)}</strong>
                </div>
              </div>
              <p className="secondary tstmt-note">Paid with gift vouchers, at the desk or online, counted by the day they were entered. The clinic holds voucher money, so Northbank owes the therapist this amount.</p>
            </>
          )}
        </div>
      )}

      <div className="tstmt-block">
        <h3 className="tstmt-label">Machine sessions</h3>
        <div className="tstmt-boxes is-two">
          <div className="tstmt-box">
            <span>Shockwave</span>
            <strong className="tnum">{s.shockwave}</strong>
          </div>
          <div className="tstmt-box">
            <span>Laser</span>
            <strong className="tnum">{s.laser}</strong>
          </div>
        </div>
      </div>

      <details className="tstat-panel tstmt-rules">
        <summary>Change {r.name.split(" ")[0]}&apos;s rules</summary>
        <RulesForm r={r} onSaved={onSaved} onError={onError} />
      </details>
    </section>
  );
}

type TierDraft = { min: string; max: string; pct: string };
const toDraft = (t: Tier[]): TierDraft[] => t.map((x) => ({ min: String(x.min), max: String(x.max), pct: String(Math.round(x.pct * 1000) / 10) }));

function RulesForm({ r, onSaved, onError }: { r: TherapistRow; onSaved: (msg: string) => Promise<void>; onError: (m: string) => void }) {
  const [model, setModel] = useState<RentModel>(r.rules.model);
  const [maxP, setMaxP] = useState(r.rules.maxPatients ? String(r.rules.maxPatients) : "");
  const [own, setOwn] = useState(r.rules.tiers.length > 0);
  const [tiers, setTiers] = useState<TierDraft[]>(toDraft(r.rules.tiers.length ? r.rules.tiers : DEFAULT_TIERS));
  const [calc, setCalc] = useState({ hours: "", b30: "0", b45: "0", b60: "0", appt: "45" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const calcMax = maxPatientsFromHours({ monthlyHours: Number(calc.hours), breaks30: Number(calc.b30) || 0, breaks45: Number(calc.b45) || 0, breaks60: Number(calc.b60) || 0, appointmentMinutes: Number(calc.appt) });
  const blank = (v: string) => v.trim() === "" || !Number.isFinite(Number(v));
  const parsedTiers: Tier[] = tiers.map((t) => ({ min: Number(t.min), max: Number(t.max), pct: Number(t.pct) / 100 }));

  const save = async () => {
    setProblem("");
    const max = maxP.trim() ? Math.round(Number(maxP)) : null;
    if (model !== "fixed" && maxP.trim() && !(max! >= 1 && max! <= 5000)) return setProblem("Max patients should be a number from 1 to 5000.");
    const useTiers = model !== "fixed" && own ? parsedTiers : [];
    if (model !== "fixed" && own && tiers.some((t) => blank(t.min) || blank(t.max) || blank(t.pct))) return setProblem("Fill in every tier box with a number.");
    const tp = tierProblem(useTiers);
    if (tp) return setProblem(tp);
    setBusy(true);
    try {
      await call("POST", { action: "rules", practitionerId: r.practitionerId, rules: { maxPatients: model === "fixed" ? null : max, model, tiers: useTiers } });
      await onSaved(`Saved ${r.name}'s rules.`);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setTier = (i: number, k: keyof TierDraft, v: string) => setTiers(tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)));

  return (
    <fieldset className="panel-form tstat-rules">
      <legend className="label">{r.name}&apos;s rules</legend>
      {r.rules.updatedAt && (
        <p className="field-hint">
          Last changed {fmtWhen(r.rules.updatedAt)}
          {r.rules.updatedBy ? ` by ${r.rules.updatedBy}` : ""}.
        </p>
      )}
      <div className="field">
        <label htmlFor={`m-${r.practitionerId}`}>How they pay rent</label>
        <select id={`m-${r.practitionerId}`} value={model} onChange={(e) => setModel(e.target.value as RentModel)}>
          {(Object.keys(MODEL_LABEL) as RentModel[]).map((m) => (
            <option key={m} value={m}>
              {MODEL_LABEL[m]}
            </option>
          ))}
        </select>
      </div>

      {model !== "fixed" && (
        <>
          <div className="field">
            <label htmlFor={`x-${r.practitionerId}`}>Max patients a month</label>
            <p className="field-hint">The most sessions they could fit in a month. Not sure? Work it out below.</p>
            <input id={`x-${r.practitionerId}`} inputMode="numeric" value={maxP} onChange={(e) => setMaxP(e.target.value)} />
          </div>

          <details className="tstat-panel tstat-calc">
            <summary>Work out max patients from their hours</summary>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`h-${r.practitionerId}`}>Hours a month</label>
                <input id={`h-${r.practitionerId}`} inputMode="decimal" value={calc.hours} onChange={(e) => setCalc({ ...calc, hours: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`a-${r.practitionerId}`}>Appointment length</label>
                <select id={`a-${r.practitionerId}`} value={calc.appt} onChange={(e) => setCalc({ ...calc, appt: e.target.value })}>
                  <option value="30">30 min</option>
                  <option value="45">45 min</option>
                  <option value="60">60 min</option>
                </select>
              </div>
            </div>
            <div className="field-row">
              {(["b30", "b45", "b60"] as const).map((k) => (
                <div className="field" key={k}>
                  <label htmlFor={`${k}-${r.practitionerId}`}>{k.slice(1)}-min breaks</label>
                  <input id={`${k}-${r.practitionerId}`} inputMode="numeric" value={calc[k]} onChange={(e) => setCalc({ ...calc, [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <p className="secondary">
              {calcMax != null ? `That's ${calcMax} patients a month.` : "Enter their hours to work it out."}{" "}
              {calcMax != null && (
                <button type="button" className="kpi-link" onClick={() => setMaxP(String(calcMax))}>
                  Use {calcMax}
                </button>
              )}
            </p>
          </details>

          <fieldset className="field">
            <legend className="label">Tiers</legend>
            <label className="checkbox">
              <input type="radio" name={`own-${r.practitionerId}`} checked={!own} onChange={() => setOwn(false)} />
              <span>The clinic&apos;s usual tiers</span>
            </label>
            <label className="checkbox">
              <input type="radio" name={`own-${r.practitionerId}`} checked={own} onChange={() => setOwn(true)} />
              <span>Their own tiers</span>
            </label>
          </fieldset>

          {own && (
            <div className="tstat-tiers">
              {tiers.map((t, i) => (
                <div className="field-row" key={i}>
                  <div className="field">
                    <label htmlFor={`tmin-${r.practitionerId}-${i}`}>Tier {i + 1} from (%)</label>
                    <input id={`tmin-${r.practitionerId}-${i}`} inputMode="decimal" value={t.min} onChange={(e) => setTier(i, "min", e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor={`tmax-${r.practitionerId}-${i}`}>to (%)</label>
                    <input id={`tmax-${r.practitionerId}-${i}`} inputMode="decimal" value={t.max} onChange={(e) => setTier(i, "max", e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor={`tpct-${r.practitionerId}-${i}`}>Rent rate (%)</label>
                    <input id={`tpct-${r.practitionerId}-${i}`} inputMode="decimal" value={t.pct} onChange={(e) => setTier(i, "pct", e.target.value)} />
                  </div>
                  <button type="button" className="btn btn-secondary tstat-remove" aria-label={`Remove tier ${i + 1}`} onClick={() => setTiers(tiers.filter((_, j) => j !== i))} disabled={tiers.length <= 1}>
                    Remove
                  </button>
                </div>
              ))}
              <div className="actions">
                <button type="button" className="btn btn-secondary" disabled={tiers.length >= 10} onClick={() => { const last = tiers[tiers.length - 1]; setTiers([...tiers, { min: last?.max ?? "0", max: "100", pct: last?.pct ?? "40" }]); }}>
                  Add a tier
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setTiers(toDraft(DEFAULT_TIERS))}>
                  Start from the usual tiers
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {problem && (
        <Notice tone="error">
          <p>{problem}</p>
        </Notice>
      )}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save rules"}
        </button>
      </div>
    </fieldset>
  );
}
