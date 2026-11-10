"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { HEAT_FROM_HOUR, HEAT_TO_HOUR, euros, pctText } from "@/core/kpi2";
import type { Card, Dir } from "@/core/kpi2-report";
import type { KpiPayload } from "@/lib/kpi2";

/**
 * Clinic KPIs v2 (Cian's report, 20 Oct 2026): every figure as an Insight
 * Card (number, compared with our own last 8 weeks, a 13-week trend, what it
 * means in people and euros, one thing to do, how far to trust it).
 * Owners and super admins only.
 */
export default function KpisPage() {
  return (
    <StaffGate permission="kpis:view" title="Clinic KPIs">
      {(me) => <Kpis canTask={me.permissions.includes("tasks:use")} />}
    </StaffGate>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: HEAT_TO_HOUR - HEAT_FROM_HOUR }, (_, i) => i + HEAT_FROM_HOUR);
const fmtDay = (d: string, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IE", o);
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function api(method: "GET" | "POST", body?: unknown) {
  const res = await fetch("/api/admin/kpis", { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Couldn't load the figures.");
  return json.data as KpiPayload;
}

function Kpis({ canTask }: { canTask: boolean }) {
  const [d, setD] = useState<KpiPayload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn: () => Promise<KpiPayload>) => {
    setBusy(true);
    setError("");
    try {
      setD(await fn());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    run(() => api("GET"));
  }, [run]);

  const makeTask = async (title: string, size: "S" | "M" | "L") => {
    try {
      const res = await fetch("/api/staff/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, size, band: "week" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Couldn't make the task.");
      setNotice(`Added to your tasks: ${title}`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!d) {
    return (
      <DashboardShell title="Clinic KPIs">
        {error ? (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        ) : (
          <p className="secondary">Working out the figures. The first time can take a minute or two…</p>
        )}
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Clinic KPIs" lede={`Week of ${fmtDay(d.week.from)} to ${fmtDay(d.week.to)}, compared with our own last 8 weeks. Owners and super admins only.`}>
      <div className="stack-5 kpi2">
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

        <section className="panel kpi-summary" aria-labelledby="kpi-summary">
          <h2 id="kpi-summary">Last week in one paragraph</h2>
          <p>{d.summary.join(" ")}</p>
          <p className="kpi-updated">
            Worked out {fmtWhen(d.computedAt)} ·{" "}
            <button className="kpi-link" disabled={busy} onClick={() => run(() => api("POST", { action: "refresh" }))}>
              {busy ? "Refreshing…" : "Refresh now"}
            </button>
          </p>
        </section>

        <NorthStar c={d.northStar} />

        <section aria-labelledby="kpi-six">
          <h2 id="kpi-six" className="visually-hidden">
            Key figures
          </h2>
          <div className="kpi-grid">
            {d.cards.map((c) => (
              <InsightCard key={c.id} c={c} canTask={canTask} makeTask={makeTask}>
                {c.id === "revenue" && <TargetForm d={d} busy={busy} onSave={(euros) => run(() => api("POST", { action: "target", euros }))} />}
              </InsightCard>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="kpi-ahead">
          <h2 id="kpi-ahead">Free time, next 2 weeks</h2>
          <p className="kpi-headline">{d.forward.headline}</p>
          <ForwardBars days={d.forward.days} />
        </section>

        <section className="panel" aria-labelledby="kpi-busy">
          <h2 id="kpi-busy">Busy times</h2>
          <p className="kpi-headline">{d.heat.headline}</p>
          {d.heat.meaning && <p className="secondary">{d.heat.meaning}</p>}
          <Heat pct={d.heat.pct} />
          <p className="kpi-conf">How full each hour was over the last 6 weeks, from {d.heat.slots.toLocaleString("en-IE")} hours of working time. Darker means fuller.</p>
        </section>

        <section className="panel" aria-labelledby="kpi-mod">
          <h2 id="kpi-mod">By treatment type, last week</h2>
          <div className="table-wrap kpi-table-wrap">
            <table className="guide-table kpi-table">
              <thead>
                <tr>
                  <th scope="col">Treatment</th>
                  <th scope="col">Booked</th>
                  <th scope="col">Attended</th>
                  <th scope="col">New</th>
                  <th scope="col">Rebooked</th>
                  <th scope="col">Missed</th>
                  <th scope="col">Value</th>
                  <th scope="col">Active</th>
                </tr>
              </thead>
              <tbody>
                {d.modalities.map((m) => (
                  <tr key={m.modality}>
                    <th scope="row">{m.label}</th>
                    <td className="tnum">{m.booked}</td>
                    <td className="tnum">{m.attended}</td>
                    <td className="tnum">{m.newPatients}</td>
                    <td className="tnum">{m.attended >= 10 ? pctText(m.rebook) : "–"}</td>
                    <td className="tnum">{m.booked >= 10 ? pctText(m.missed) : "–"}</td>
                    <td className="tnum">{euros(m.valueMinor)}</td>
                    <td className="tnum">{m.active.toLocaleString("en-IE")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="kpi-conf">Percentages need at least 10 appointments; below that they show as –.</p>
        </section>

        <section className="panel" aria-labelledby="kpi-team">
          <h2 id="kpi-team">By therapist, last week</h2>
          <p className="secondary">For coaching conversations with each therapist against their own past, not a league table.</p>
          <div className="table-wrap kpi-table-wrap">
            <table className="guide-table kpi-table">
              <thead>
                <tr>
                  <th scope="col">Therapist</th>
                  <th scope="col">Hours</th>
                  <th scope="col">How full</th>
                  <th scope="col">Booked</th>
                  <th scope="col">Rebooked</th>
                  <th scope="col">Missed</th>
                  <th scope="col">New</th>
                  <th scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                {d.therapists.map((t) => (
                  <tr key={t.id}>
                    <th scope="row">{d.practitioners[t.id] ?? t.id}</th>
                    <td className="tnum">{t.availableHours || "–"}</td>
                    <td className="tnum">{t.availableHours ? pctText(t.utilisation) : "–"}</td>
                    <td className="tnum">{t.booked}</td>
                    <td className="tnum">{t.attended >= 10 ? pctText(t.rebook) : t.attended ? `${Math.round((t.rebook ?? 0) * t.attended)} of ${t.attended}` : "–"}</td>
                    <td className="tnum">{t.booked >= 10 ? pctText(t.missed) : "–"}</td>
                    <td className="tnum">{t.newPatients}</td>
                    <td className="tnum">{euros(t.valueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {d.notes.length > 0 && (
          <Notice title="About the data">
            <ul>
              {d.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Notice>
        )}

        <details className="panel">
          <summary>How these are worked out</summary>
          <dl className="kpi-defs">
            {d.definitions.map((x) => (
              <div key={x.label}>
                <dt>{x.label}</dt>
                <dd>{x.text}</dd>
              </div>
            ))}
          </dl>
          <p className="secondary">These figures describe the clinic. They are not used for appraisal.</p>
        </details>
      </div>
    </DashboardShell>
  );
}

const arrow = (dir: Dir) => (dir === "up" ? "▲" : dir === "down" ? "▼" : dir === "normal" ? "●" : "");

function Change({ change }: { change: Card["change"] }) {
  const tone = change.good == null ? "" : change.good ? " is-good" : " is-bad";
  return (
    <p className={`kpi-change${tone}`}>
      {arrow(change.dir) && <span aria-hidden="true">{arrow(change.dir)} </span>}
      {change.text}
    </p>
  );
}

function InsightCard({ c, canTask, makeTask, children }: { c: Card; canTask: boolean; makeTask: (t: string, s: "S" | "M" | "L") => void; children?: React.ReactNode }) {
  const muted = c.confidence.level === "none";
  return (
    <article className={`kpi-card${muted ? " is-muted" : ""}`} aria-labelledby={`card-${c.id}`}>
      <header className="kpi-card-head">
        <h3 id={`card-${c.id}`}>{c.label}</h3>
        <details className="kpi-info">
          <summary aria-label={`What is ${c.label}?`}>ⓘ</summary>
          <p>{c.definition}</p>
        </details>
      </header>
      <div className="kpi-value-row">
        <p className="kpi-value tnum">{c.value}</p>
        <Spark values={c.spark} label={`${c.label}, last 13 weeks`} />
      </div>
      <Change change={c.change} />
      {c.bullet && <Bullet b={c.bullet} />}
      <p className="kpi-meaning">{c.meaning}</p>
      {c.action && (
        <div className="kpi-action">
          <p>
            <strong>What to do:</strong> {c.action.text}
          </p>
          {canTask && c.action.task && (
            <button className="btn btn-secondary" onClick={() => makeTask(c.action!.task!.title, c.action!.task!.size)}>
              Add to my tasks
            </button>
          )}
        </div>
      )}
      {children}
      <p className="kpi-conf">{c.confidence.text}</p>
    </article>
  );
}

function NorthStar({ c }: { c: KpiPayload["northStar"] }) {
  return (
    <article className="kpi-card kpi-north" aria-labelledby="card-north">
      <header className="kpi-card-head">
        <h2 id="card-north">
          {c.label} <span className="kpi-tag">Headline</span>
        </h2>
        <details className="kpi-info">
          <summary aria-label="What is this?">ⓘ</summary>
          <p>{c.definition}</p>
        </details>
      </header>
      <div className="kpi-north-body">
        <div>
          <div className="kpi-value-row">
            <p className="kpi-value kpi-value-xl tnum">{c.value}</p>
            <Spark values={c.spark} label="Last 13 weeks" />
          </div>
          <Change change={c.change} />
          <p className="kpi-meaning">{c.meaning}</p>
        </div>
        <ul className="kpi-drivers" aria-label="What makes it up">
          {c.drivers.map((x, i) => (
            <li key={x.label}>
              {i > 0 && (
                <span className="kpi-times" aria-hidden="true">
                  ×
                </span>
              )}
              <span className="kpi-driver-label">{x.label}</span>
              <span className={`kpi-driver-value tnum${x.good == null ? "" : x.good ? " is-good" : " is-bad"}`}>
                {x.value} {arrow(x.dir) && x.dir !== "normal" ? <span aria-label={x.dir === "up" ? "up" : "down"}>{arrow(x.dir)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="kpi-conf">{c.confidence.text}</p>
    </article>
  );
}

function Spark({ values, label }: { values: (number | null)[]; label: string }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map((p) => p[1]));
  const max = Math.max(...pts.map((p) => p[1]));
  const W = 96;
  const H = 28;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (W - 4) + 2;
  const y = (v: number) => (max === min ? H / 2 : H - 3 - ((v - min) / (max - min)) * (H - 6));
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r="3" fill="currentColor" />
    </svg>
  );
}

function Bullet({ b }: { b: NonNullable<Card["bullet"]> }) {
  const p = (v: number) => `${Math.max(0, Math.min(100, (v / b.max) * 100))}%`;
  return (
    <div className="kpi-bullet" role="img" aria-label={[b.valueLabel, b.targetLabel].filter(Boolean).join(", ")}>
      <div className="kpi-bullet-track">
        {b.low != null && b.high != null && <span className="kpi-bullet-range" style={{ left: p(b.low), width: `calc(${p(b.high)} - ${p(b.low)})` }} />}
        {b.low == null && b.high != null && <span className="kpi-bullet-forecast" style={{ width: p(b.high) }} />}
        <span className="kpi-bullet-bar" style={{ width: p(b.value) }} />
        {b.target != null && <span className="kpi-bullet-target" style={{ left: p(b.target) }} />}
      </div>
      <div className="kpi-bullet-legend">
        <span>{b.valueLabel}</span>
        {b.low == null && b.high != null && <span>Forecast {euros(b.high)}</span>}
        {b.targetLabel && <span>{b.targetLabel}</span>}
      </div>
    </div>
  );
}

function TargetForm({ d, busy, onSave }: { d: KpiPayload; busy: boolean; onSave: (euros: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(d.target.set ? String(Math.round(d.month.targetMinor / 100)) : "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value.replace(/[^\d.]/g, ""));
    onSave(n > 0 ? n : null);
    setOpen(false);
  };
  if (!open)
    return (
      <button className="kpi-link" onClick={() => setOpen(true)}>
        {d.target.set ? `Change ${d.month.label}'s target` : `Set ${d.month.label}'s target`}
      </button>
    );
  return (
    <form className="kpi-target" onSubmit={submit}>
      <label htmlFor="kpi-target">Target for {d.month.label} (€)</label>
      <div className="kpi-target-row">
        <input id="kpi-target" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 48000" />
        <button className="btn btn-primary" disabled={busy} type="submit">
          Save
        </button>
      </div>
      <p className="kpi-conf">Leave it empty to go back to last month + 10%.</p>
    </form>
  );
}

function ForwardBars({ days }: { days: KpiPayload["forward"]["days"] }) {
  const max = Math.max(60, ...days.map((x) => x.emptyMin));
  return (
    <ul className="kpi-days" aria-label="Free hours per day">
      {days.map((x) => {
        const closed = x.availableMin === 0;
        const h = Math.round(x.emptyMin / 60);
        return (
          <li key={x.day} title={closed ? "No working hours" : `${h} free hour${h === 1 ? "" : "s"}`}>
            <span className="kpi-day-bar">
              <span style={{ height: closed ? 0 : `${Math.max(4, (x.emptyMin / max) * 100)}%` }} />
            </span>
            <span className="kpi-day-value tnum">{closed ? "–" : h}</span>
            <span className="kpi-day-label">{fmtDay(x.day, { weekday: "short" }).slice(0, 2)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Heat({ pct }: { pct: (number | null)[][] }) {
  return (
    <div className="table-wrap kpi-table-wrap">
      <table className="kpi-heat">
        <caption className="visually-hidden">How full each weekday and hour was</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Day</span>
            </th>
            {HOURS.map((h) => (
              <th key={h} scope="col">
                {String(h).padStart(2, "0")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((w, wi) => (
            <tr key={w}>
              <th scope="row">{w}</th>
              {HOURS.map((h) => {
                const v = pct[wi]?.[h];
                return (
                  <td
                    key={h}
                    title={v == null ? `${w} ${h}:00 – no working hours` : `${w} ${h}:00 – ${Math.round(v * 100)}% full`}
                    style={v == null ? undefined : { background: `color-mix(in srgb, var(--color-primary) ${Math.round(8 + Math.min(1, v) * 82)}%, var(--color-surface))` }}
                    className={v != null && v > 0.6 ? "is-dark" : undefined}
                  >
                    {v == null ? "" : Math.round(v * 100)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
