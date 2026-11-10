"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import {
  TIMESHEET_TYPES,
  TYPE_LABEL,
  addDays,
  byWeek,
  clock,
  clockLabel,
  duration,
  parseClock,
  payableMinutes,
  totals,
  weekOf,
  type TimesheetType,
} from "@/core/timesheets";

/**
 * Timesheets (core/timesheets.ts). Your own: clock in and out, add or fix an
 * entry, weekly totals. Reception, owners and super admins also pick anyone
 * (or everyone), see totals per person and download a CSV for payroll.
 * Every rule is checked again on the server (lib/timesheets.ts).
 */
export default function TimesheetsPage() {
  return (
    <StaffGate permission="guides:therapist" title="Timesheets">
      {() => <Timesheets />}
    </StaffGate>
  );
}

type Entry = {
  id: string;
  userId: string;
  name: string;
  type: TimesheetType;
  day: string;
  startMin: number;
  endMin: number | null;
  breakMin: number;
  notes: string;
  updatedAt: string;
  updatedByName: string | null;
};
type Data = {
  me: { id: string; name: string; enabled: boolean; seeAll: boolean };
  people: { id: string; name: string }[];
  person: string;
  from: string;
  to: string;
  today: string;
  entries: Entry[];
  open: Entry | null;
};
type Form = { id: string | null; person: string; type: TimesheetType; day: string; start: string; end: string; breakMin: string; notes: string };

const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const editedLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function Timesheets() {
  const [data, setData] = useState<Data | null>(null);
  const [person, setPerson] = useState<string | null>(null); // null until the first load decides
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (person) q.set("person", person);
    if (range) {
      q.set("from", range.from);
      q.set("to", range.to);
    }
    const res = await fetch(`/api/staff/timesheets?${q}`, { cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(d.error ?? "Couldn't load timesheets.");
    setError(null);
    // Reception or an owner without their own timesheets starts on everyone.
    if (person === null && !d.me.enabled && d.me.seeAll) return setPerson("all");
    setData(d);
    if (!range) setRange({ from: d.from, to: d.to });
  }, [person, range]);
  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) {
    return (
      <DashboardShell title="Timesheets" narrow>
        <Notice tone="error">
          <p>{error}</p>
        </Notice>
      </DashboardShell>
    );
  }
  if (!data || !range) return <DashboardShell title="Timesheets" narrow>{<p className="secondary">Loading…</p>}</DashboardShell>;

  const { me, today } = data;
  const viewing = person ?? me.id;
  const everyone = viewing === "all";
  const nameOf = (id: string) => (id === me.id ? me.name : data.people.find((p) => p.id === id)?.name ?? "");

  function startForm(e?: Entry) {
    setNotice(null);
    setForm(
      e
        ? { id: e.id, person: e.userId, type: e.type, day: e.day, start: clock(e.startMin), end: e.endMin == null ? "" : clock(e.endMin), breakMin: String(e.breakMin), notes: e.notes }
        : { id: null, person: everyone ? (data!.people[0]?.id ?? me.id) : viewing === "me" ? me.id : viewing, type: "worked", day: today, start: "09:00", end: "17:00", breakMin: "0", notes: "" }
    );
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    const body = { person: form.person, type: form.type, day: form.day, start: form.start, end: form.end, breakMin: Number(form.breakMin || 0), notes: form.notes };
    const r = form.id ? await send(`/api/staff/timesheets/${form.id}`, "PATCH", body) : await send("/api/staff/timesheets", "POST", body);
    setBusy(false);
    if (!r.ok) return setNotice({ tone: "warning", text: r.data.error ?? "Couldn't save." });
    setForm(null);
    setNotice(r.data.warnings?.length ? { tone: "warning", text: `Saved. ${r.data.warnings.join(" ")}` } : { tone: "success", text: "Saved." });
    load();
  }

  async function remove(e: Entry) {
    if (!window.confirm(`Delete ${TYPE_LABEL[e.type].toLowerCase()} on ${dayLabel(e.day)}${e.userId !== me.id ? ` for ${e.name}` : ""}? This can't be undone.`)) return;
    const r = await send(`/api/staff/timesheets/${e.id}`, "DELETE");
    setNotice(r.ok ? { tone: "success", text: "Deleted." } : { tone: "warning", text: r.data.error ?? "Couldn't delete." });
    load();
  }

  async function clockInOut(action: "in" | "out") {
    setBusy(true);
    const r = await send("/api/staff/timesheets/clock", "POST", { action });
    setBusy(false);
    setNotice(r.ok ? { tone: "success", text: r.data.message } : { tone: "warning", text: r.data.error ?? "That didn't work." });
    load();
  }

  const setPeriod = (from: string, to: string) => setRange({ from, to });
  const monthStart = `${today.slice(0, 8)}01`;
  const exportUrl = `/api/staff/timesheets/export?${new URLSearchParams({ person: everyone ? "all" : viewing, from: range.from, to: range.to })}`;

  return (
    <DashboardShell
      title="Timesheets"
      lede={me.seeAll ? "Hours worked and leave, for you and everyone with timesheets. Download them for payroll." : "Your hours worked and leave."}
    >
      <div className="stack-5">
        {notice && (
          <Notice tone={notice.tone}>
            <p>{notice.text}</p>
          </Notice>
        )}
        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}

        {me.enabled && (
          <section className="panel clock-panel" aria-labelledby="clock-title">
            <h2 id="clock-title" className="panel-title">
              {data.open ? `Clocked in since ${clockLabel(data.open.startMin)}${data.open.day !== today ? ` on ${dayLabel(data.open.day)}` : ""}` : "Not clocked in"}
            </h2>
            {data.open && data.open.day !== today ? (
              <p className="secondary">You didn&apos;t clock out that day. Press Edit on that entry below to add the time you finished.</p>
            ) : (
              <div className="actions">
                {data.open ? (
                  <button className="btn btn-primary" disabled={busy} onClick={() => clockInOut("out")}>
                    Clock out now
                  </button>
                ) : (
                  <button className="btn btn-primary" disabled={busy} onClick={() => clockInOut("in")}>
                    Clock in now
                  </button>
                )}
                <button className="btn btn-secondary" onClick={() => startForm()}>
                  Add an entry
                </button>
              </div>
            )}
          </section>
        )}

        <div className="toolbar">
          {me.seeAll && (
            <div className="field">
              <label htmlFor="ts-person">Whose</label>
              <select id="ts-person" value={everyone ? "all" : viewing} onChange={(e) => (setForm(null), setPerson(e.target.value))}>
                {me.enabled && <option value={me.id}>Mine</option>}
                <option value="all">Everyone</option>
                {data.people
                  .filter((p) => p.id !== me.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="ts-from">From</label>
            <input id="ts-from" type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setPeriod(e.target.value, range.to)} />
          </div>
          <div className="field">
            <label htmlFor="ts-to">To</label>
            <input id="ts-to" type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setPeriod(range.from, e.target.value)} />
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => setPeriod(weekOf(today), today)}>
            This week
          </button>
          <button className="btn btn-secondary" onClick={() => setPeriod(addDays(weekOf(today), -7), addDays(weekOf(today), -1))}>
            Last week
          </button>
          <button className="btn btn-secondary" onClick={() => setPeriod(monthStart, today)}>
            This month
          </button>
          <a className="btn btn-secondary" href={exportUrl}>
            Download CSV
          </a>
          {me.seeAll && (
            <button className="btn btn-primary" onClick={() => startForm()} disabled={everyone && data.people.length === 0}>
              Add an entry
            </button>
          )}
        </div>

        {form && (
          <EntryForm
            form={form}
            setForm={setForm}
            busy={busy}
            onSave={save}
            people={me.seeAll ? [...(me.enabled ? [{ id: me.id, name: `${me.name} (me)` }] : []), ...data.people.filter((p) => p.id !== me.id)] : []}
            today={today}
          />
        )}

        {everyone && <Totals entries={data.entries} people={data.people} />}

        <EntryList entries={data.entries} showName={everyone || viewing !== me.id} onEdit={startForm} onDelete={remove} />

        {data.entries.length === 0 && <p className="secondary">No entries between {dayLabel(range.from)} and {dayLabel(range.to)}.</p>}
        {!everyone && viewing !== me.id && <p className="secondary">Showing {nameOf(viewing)}&apos;s timesheet.</p>}
      </div>
    </DashboardShell>
  );
}

function EntryForm({
  form,
  setForm,
  busy,
  onSave,
  people,
  today,
}: {
  form: Form;
  setForm: (f: Form | null) => void;
  busy: boolean;
  onSave: () => void;
  people: { id: string; name: string }[];
  today: string;
}) {
  const s = parseClock(form.start);
  const e = form.end ? parseClock(form.end) : null;
  const payable = s != null && e != null && e > s ? payableMinutes({ startMin: s, endMin: e, breakMin: Number(form.breakMin || 0) }) : 0;
  const set = (k: keyof Form) => (ev: { target: { value: string } }) => setForm({ ...form, [k]: ev.target.value });
  return (
    <form
      className="panel stack-3"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        onSave();
      }}
    >
      <h2 className="panel-title">{form.id ? "Change entry" : "Add an entry"}</h2>
      {people.length > 0 && !form.id && (
        <div className="field">
          <label htmlFor="f-person">Who</label>
          <select id="f-person" value={form.person} onChange={set("person")}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field-row">
        <div className="field">
          <label htmlFor="f-type">Type</label>
          <select id="f-type" value={form.type} onChange={set("type")}>
            {TIMESHEET_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-day">Date</label>
          <input id="f-day" type="date" value={form.day} max={form.type === "worked" ? today : undefined} onChange={set("day")} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="f-start">Start</label>
          <input id="f-start" type="time" value={form.start} onChange={set("start")} />
        </div>
        <div className="field">
          <label htmlFor="f-end">End</label>
          <input id="f-end" type="time" value={form.end} onChange={set("end")} />
        </div>
        <div className="field">
          <label htmlFor="f-break">Unpaid break (minutes)</label>
          <input id="f-break" className="input-short" inputMode="numeric" value={form.breakMin} onChange={set("breakMin")} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="f-notes">Notes (optional)</label>
        <input id="f-notes" maxLength={500} value={form.notes} onChange={set("notes")} />
      </div>
      <p>
        Payable time: <strong className="tnum">{duration(payable)}</strong>
      </p>
      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => setForm(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Totals({ entries, people }: { entries: Entry[]; people: { id: string; name: string }[] }) {
  const t = useMemo(() => totals(entries), [entries]);
  if (!people.length) return <Notice title="Nobody has timesheets yet">{<p>Switch them on for someone on the Team page.</p>}</Notice>;
  return (
    <div className="table-wrap">
      <table className="guide-table">
        <caption className="visually-hidden">Total payable time per person for this period</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Worked</th>
            <th scope="col">Leave and other</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const x = t.get(p.id);
            const worked = x?.byType.worked ?? 0;
            return (
              <tr key={p.id}>
                <th scope="row">{p.name}</th>
                <td className="tnum">{duration(worked)}</td>
                <td className="tnum">{duration((x?.totalMin ?? 0) - worked)}</td>
                <td className="tnum">
                  <strong>{duration(x?.totalMin ?? 0)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EntryList({ entries, showName, onEdit, onDelete }: { entries: Entry[]; showName: boolean; onEdit: (e: Entry) => void; onDelete: (e: Entry) => void }) {
  const weeks = useMemo(() => byWeek(entries), [entries]);
  return (
    <div className="stack-5">
      {weeks.map((w) => (
        <section key={w.monday} className="stack-3" aria-labelledby={`w-${w.monday}`}>
          <h2 id={`w-${w.monday}`} className="timesheet-week">
            <span>Week of {dayLabel(w.monday)}</span> <span className="tnum">{duration(w.totalMin)}</span>
          </h2>
          <ul className="plain-list stack-3" role="list">
            {w.entries.map((e) => (
              <li key={e.id} className="panel timesheet-entry">
                <div className="timesheet-main">
                  <p>
                    <strong>{dayLabel(e.day)}</strong>
                    {showName && <> · {e.name}</>} <span className={`badge${e.type === "worked" ? "" : " is-warn"}`}>{TYPE_LABEL[e.type]}</span>
                  </p>
                  <p className="tnum">
                    {clockLabel(e.startMin)} – {e.endMin == null ? <em>clocked in</em> : clockLabel(e.endMin)}
                    {e.breakMin ? ` · ${e.breakMin} min unpaid break` : ""} · <strong>{duration(payableMinutes(e))}</strong>
                  </p>
                  {e.notes && <p className="secondary">{e.notes}</p>}
                  <p className="meta">
                    Last edited {editedLabel(e.updatedAt)}
                    {e.updatedByName ? ` by ${e.updatedByName}` : ""}
                  </p>
                </div>
                <div className="actions">
                  <button className="btn btn-secondary" onClick={() => onEdit(e)}>
                    Edit
                  </button>
                  <button className="btn btn-destructive" onClick={() => onDelete(e)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
