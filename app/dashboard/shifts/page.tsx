"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { addDays } from "@/core/policy";
import { CLINIKO_WEB_URL } from "@/core/invoicing";
import {
  HORIZON_DAYS,
  STATUS_LABEL,
  WEEKDAYS,
  WEEK_LABEL,
  daysFor,
  describeRule,
  niceDay,
  repeats,
  ruleProblems,
  type ShiftDayStatus,
  type ShiftPattern,
  type ShiftRuleInput,
  type WeekOfMonth,
} from "@/core/shifts";

/**
 * Therapist shifts (31 Oct 2026): working days Cliniko's weekly hours can't
 * repeat (alternate Saturdays, two Mondays a month, days picked by hand). The
 * Hub adds them to the therapist's Cliniko diary as extra availability. See
 * core/shifts.ts and lib/shifts.ts.
 */
export default function ShiftsPage() {
  return (
    <StaffGate permission="shifts:manage" title="Therapist shifts">
      {() => <Shifts />}
    </StaffGate>
  );
}

type Day = { day: string; status: ShiftDayStatus; error?: string; booked?: number };
type Rule = ShiftRuleInput & { id: string; practitionerName: string; businessName: string; description: string; createdBy: string; createdAt: string; stoppedAt?: string; stoppedBy?: string; days: Day[] };
type Data = {
  today: string;
  businesses: { id: string; name: string }[];
  practitioners: { id: string; name: string; businessIds: string[] }[];
  rules: Rule[];
};
type Msg = { tone: "success" | "error" | "warning" | "info"; text: string } | null;

const BADGE: Record<ShiftDayStatus, string> = { to_add: "is-warn", adding: "is-warn", added: "is-good", failed: "is-bad", to_remove: "is-warn", removed: "" };

function Shifts() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/admin/shifts", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't load the shifts.");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (key: string, body: object) => {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Something went wrong. Try again in a minute.");
      setMsg({ tone: json.tone ?? "success", text: json.message });
      await load();
      return true;
    } catch (e: any) {
      setMsg({ tone: "error", text: e.message });
      return false;
    } finally {
      setBusy("");
    }
  };

  const byTherapist = useMemo(() => {
    const m = new Map<string, Rule[]>();
    for (const r of data?.rules ?? []) m.set(r.practitionerName, [...(m.get(r.practitionerName) ?? []), r]);
    return [...m.entries()];
  }, [data]);

  return (
    <DashboardShell
      title="Therapist shifts"
      lede="Working days Cliniko can't repeat by itself, like alternate Saturdays or two Mondays a month. The Hub adds them to the therapist's Cliniko diary, so online booking and Cliniko both offer those times."
    >
      <div className="stack-5">
        <Notice title="Before you start">
          <ul>
            <li>Leave these days out of the therapist&apos;s regular weekly hours in Cliniko, or the time is there twice.</li>
            <li>
              Cliniko doesn&apos;t let the Hub delete a day once it&apos;s in the diary. When you take one off here, delete it in Cliniko too (click the
              extra availability in the diary). The Hub ticks it off once it&apos;s gone.
            </li>
          </ul>
        </Notice>

        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {!data && !error && <p className="secondary">Loading…</p>}
        {msg && (
          <Notice tone={msg.tone}>
            <p>{msg.text}</p>
          </Notice>
        )}

        {data && <AddDays data={data} busy={busy === "create"} onAdd={(rule) => act("create", { action: "create", rule })} />}

        {data && (
          <section className="stack-4">
            <div className="row-actions" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>Added on the Hub</h2>
              <button className="btn btn-secondary" disabled={!!busy} onClick={() => act("sync", { action: "sync" })}>
                {busy === "sync" ? "Checking…" : "Check Cliniko again"}
              </button>
            </div>
            {!byTherapist.length && <p className="secondary">Nothing yet. Days you add appear here.</p>}
            {byTherapist.map(([name, rules]) => (
              <div key={name} className="panel stack-4">
                <h3 className="panel-title">{name}</h3>
                {rules.map((r) => (
                  <RuleCard key={r.id} r={r} today={data.today} multiLocation={data.businesses.length > 1} busy={busy} act={act} />
                ))}
              </div>
            ))}
          </section>
        )}
      </div>
    </DashboardShell>
  );
}

function RuleCard({ r, today, multiLocation, busy, act }: { r: Rule; today: string; multiLocation: boolean; busy: string; act: (key: string, body: object) => Promise<boolean> }) {
  const [showAll, setShowAll] = useState(false);
  const shown = r.days.filter((d) => d.status === "to_remove" || (d.day >= today && d.status !== "removed"));
  const list = showAll ? shown : shown.slice(0, 8);
  const toRemove = shown.filter((d) => d.status === "to_remove");
  const stuck = shown.some((d) => d.status === "failed" || d.status === "to_add");
  return (
    <div className="stack-3 shift-rule">
      <p>
        <strong>{r.description}</strong>
        {multiLocation && <> · {r.businessName}</>}
        {r.stoppedAt && (
          <>
            {" "}
            <span className="badge">Stopped</span>
          </>
        )}
      </p>
      {r.note && <p className="secondary">{r.note}</p>}
      <p className="secondary">
        Added by {r.createdBy.replace(/ \(.*\)$/, "")}
        {r.stoppedBy ? `, stopped by ${r.stoppedBy.replace(/ \(.*\)$/, "")}` : ""}.
        {repeats(r.pattern) && !r.stoppedAt && " Kept topped up three months ahead."}
      </p>
      {toRemove.length > 0 && (
        <Notice tone="warning" title={`Delete ${toRemove.length === 1 ? "this day" : "these days"} in Cliniko`}>
          <p>
            {toRemove.map((d) => niceDay(d.day)).join(", ")}: open {r.practitionerName}&apos;s diary in{" "}
            <a href={CLINIKO_WEB_URL} target="_blank" rel="noreferrer">
              Cliniko
            </a>{" "}
            on that day, click the extra availability and delete it.
            {toRemove.some((d) => d.booked) && " Move the patients booked in that time first."}
          </p>
        </Notice>
      )}
      <ul className="shift-days">
        {list.map((d) => (
          <li key={d.day}>
            <span className="shift-day">{niceDay(d.day)}</span>
            <span className={`badge ${BADGE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
            {d.booked ? <span className="secondary">{d.booked} booked</span> : null}
            {d.status === "failed" && d.error && <span className="secondary shift-error">{friendlyError(d.error)}</span>}
            <span className="shift-actions">
              {(d.status === "added" || d.status === "to_add" || d.status === "failed") && (
                <button className="link-button" disabled={!!busy} onClick={() => act(`rm-${r.id}-${d.day}`, { action: "remove", id: r.id, day: d.day })}>
                  {busy === `rm-${r.id}-${d.day}` ? "Taking off…" : "Take off"}
                </button>
              )}
              {d.status === "to_remove" && (
                <button className="link-button" disabled={!!busy} onClick={() => act(`keep-${r.id}-${d.day}`, { action: "keep", id: r.id, day: d.day })}>
                  Keep it
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {shown.length > list.length && (
        <button className="link-button" onClick={() => setShowAll(true)}>
          Show all {shown.length} days
        </button>
      )}
      <div className="row-actions">
        {stuck && (
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => act(`sync-${r.id}`, { action: "sync", id: r.id })}>
            {busy === `sync-${r.id}` ? "Adding…" : "Try again"}
          </button>
        )}
        {repeats(r.pattern) && !r.stoppedAt && (
          <button
            className="btn btn-secondary"
            disabled={!!busy}
            onClick={() => window.confirm(`Stop "${r.description}"? No more days will be added. Days already in Cliniko stay until you take them off.`) && act(`stop-${r.id}`, { action: "stop", id: r.id })}
          >
            Stop repeating
          </button>
        )}
      </div>
    </div>
  );
}

const friendlyError = (e: string) =>
  /timeout|aborted/i.test(e) ? "Cliniko didn't answer in time." : /422/.test(e) ? "Cliniko refused it. Check the therapist works at that location." : /5\d\d/.test(e) ? "Cliniko was having problems." : "Something went wrong.";

type Kind = ShiftPattern["kind"];

function AddDays({ data, busy, onAdd }: { data: Data; busy: boolean; onAdd: (rule: ShiftRuleInput) => Promise<boolean> }) {
  const [practitionerId, setPractitionerId] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [kind, setKind] = useState<Kind>("dates");
  const [dates, setDates] = useState<string[]>([""]);
  const [firstDay, setFirstDay] = useState("");
  const [every, setEvery] = useState<2 | 3 | 4>(2);
  const [weekday, setWeekday] = useState(1);
  const [weeks, setWeeks] = useState<WeekOfMonth[]>([]);
  const [fromDay, setFromDay] = useState(data.today);
  const [untilDay, setUntilDay] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);

  const p = data.practitioners.find((x) => x.id === practitionerId);
  const locations = data.businesses.filter((b) => p?.businessIds.includes(b.id));
  const location = locations.length === 1 ? locations[0].id : businessId;

  const pattern: ShiftPattern =
    kind === "dates"
      ? { kind, dates: dates.filter(Boolean) }
      : kind === "every_n_weeks"
        ? { kind, firstDay, every, untilDay: untilDay || null }
        : { kind, weekday, weeks, fromDay, untilDay: untilDay || null };
  const input: ShiftRuleInput = { practitionerId, businessId: location, start, end, pattern, note: note.trim() || null };
  const problems = ruleProblems(input, data.today);
  const days = problems.length ? [] : daysFor(pattern, data.today, repeats(pattern) ? addDays(data.today, HORIZON_DAYS) : addDays(data.today, 400));

  const reset = () => {
    setDates([""]);
    setFirstDay("");
    setWeeks([]);
    setUntilDay("");
    setNote("");
    setTried(false);
  };

  const submit = async () => {
    setTried(true);
    if (problems.length) return;
    if (await onAdd(input)) reset();
  };

  const toggleWeek = (w: WeekOfMonth) => setWeeks((ws) => (ws.includes(w) ? ws.filter((x) => x !== w) : [...ws, w]));

  return (
    <section className="panel stack-4">
      <h2 className="panel-title">Add working days</h2>
      <div className="field-row">
        <div className="field">
          <label htmlFor="sh-who">Therapist</label>
          <select id="sh-who" value={practitionerId} onChange={(e) => (setPractitionerId(e.target.value), setBusinessId(""))}>
            <option value="">Choose…</option>
            {data.practitioners.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        {locations.length > 1 && (
          <div className="field">
            <label htmlFor="sh-where">Location</label>
            <select id="sh-where" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
              <option value="">Choose…</option>
              {locations.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="sh-start">From</label>
          <input id="sh-start" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sh-end">To</label>
          <input id="sh-end" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>

      <fieldset className="radio-list">
        <legend className="label">Which days</legend>
        {(
          [
            ["dates", "Pick the dates", "e.g. the two Mondays Tom is in this month"],
            ["every_n_weeks", "Every other week", "e.g. alternate Saturdays, from the first one"],
            ["weeks_of_month", "Certain weeks of the month", "e.g. the 1st and 3rd Friday of every month"],
          ] as [Kind, string, string][]
        ).map(([k, label, hint]) => (
          <label key={k} className="radio">
            <input type="radio" name="sh-kind" checked={kind === k} onChange={() => setKind(k)} />
            <span>
              <span className="radio-label">{label}</span>
              <span className="radio-hint">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {kind === "dates" && (
        <div className="stack-3">
          {dates.map((d, i) => (
            <div key={i} className="shift-date-row">
              <div className="field">
                <label htmlFor={`sh-date-${i}`}>Date {dates.length > 1 ? i + 1 : ""}</label>
                <input id={`sh-date-${i}`} type="date" min={data.today} value={d} onChange={(e) => setDates((ds) => ds.map((x, j) => (j === i ? e.target.value : x)))} />
              </div>
              {dates.length > 1 && (
                <button className="link-button" onClick={() => setDates((ds) => ds.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button className="btn btn-secondary" onClick={() => setDates((ds) => [...ds, ""])}>
            Add another date
          </button>
        </div>
      )}

      {kind === "every_n_weeks" && (
        <div className="field-row">
          <div className="field">
            <label htmlFor="sh-first">First day</label>
            <input id="sh-first" type="date" min={data.today} value={firstDay} onChange={(e) => setFirstDay(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sh-every">Repeats</label>
            <select id="sh-every" value={every} onChange={(e) => setEvery(Number(e.target.value) as 2 | 3 | 4)}>
              <option value={2}>Every other week</option>
              <option value={3}>Every 3rd week</option>
              <option value={4}>Every 4th week</option>
            </select>
          </div>
        </div>
      )}

      {kind === "weeks_of_month" && (
        <div className="stack-3">
          <div className="field-row">
            <div className="field">
              <label htmlFor="sh-weekday">Day</label>
              <select id="sh-weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((w, i) => (
                  <option key={w} value={i}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sh-from">Starting from</label>
              <input id="sh-from" type="date" min={data.today} value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
            </div>
          </div>
          <fieldset className="field">
            <legend>Which weeks of the month</legend>
            <div className="shift-weeks">
              {([1, 2, 3, 4, 5, -1] as WeekOfMonth[]).map((w) => (
                <label key={w} className="checkbox">
                  <input type="checkbox" checked={weeks.includes(w)} onChange={() => toggleWeek(w)} />
                  <span>
                    {WEEK_LABEL[w][0].toUpperCase() + WEEK_LABEL[w].slice(1)}
                    {w === 5 ? " (when there is one)" : ""}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {kind !== "dates" && (
        <div className="field">
          <label htmlFor="sh-until">Until (optional)</label>
          <input id="sh-until" type="date" min={data.today} value={untilDay} onChange={(e) => setUntilDay(e.target.value)} />
          <p className="field-hint">Leave empty to keep going. The Hub adds three months at a time and tops up every night.</p>
        </div>
      )}

      <div className="field">
        <label htmlFor="sh-note">Note (optional)</label>
        <input id="sh-note" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Swaps with Lucy" />
      </div>

      {tried && problems.length > 0 && (
        <Notice tone="error" title="Check these">
          <ul>
            {problems.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Notice>
      )}

      {days.length > 0 && p && (
        <div className="stack-3 shift-preview">
          <p>
            <strong>{p.name}</strong>: {describeRule(input)}
          </p>
          <ul className="shift-chips">
            {days.map((d) => (
              <li key={d} className="badge">
                {niceDay(d)}
              </li>
            ))}
          </ul>
          {repeats(pattern) && <p className="secondary">Then more every night, three months ahead{untilDay ? ` until ${niceDay(untilDay)}` : ""}.</p>}
        </div>
      )}

      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy} onClick={submit}>
          {busy ? "Adding to Cliniko…" : days.length && p ? `Add ${days.length} day${days.length === 1 ? "" : "s"} to ${p.name.split(" ")[0]}'s diary` : "Add to Cliniko"}
        </button>
      </div>
    </section>
  );
}
