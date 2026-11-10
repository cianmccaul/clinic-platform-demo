"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { Grove, TreeSvg } from "@/components/dashboard/ClinicTree";
import { BANDS, BAND_LABEL, NUDGE_POINTS, STAGE_LABEL, TASK_SIZES, percent, ruleLabel, treeStage, type Band, type Priority, type TaskRule, type TaskSize } from "@/core/tasks";
import type { TaskOut, TemplateOut } from "@/lib/tasks";

/**
 * Tasks, with the Clinic Tree (core/tasks.ts): reception, owners and super
 * admins. Your list, what you've given others, repeating tasks, a team tree
 * everyone grows together and your own private tree.
 */
export default function TasksPage() {
  return (
    <StaffGate permission="tasks:use" title="Tasks">
      {() => <Tasks />}
    </StaffGate>
  );
}

type Data = {
  me: { id: string; name: string; manager: boolean };
  today: string;
  monday: string;
  people: { id: string; name: string; openPoints: number }[];
  tasks: TaskOut[];
  given: TaskOut[];
  templates: TemplateOut[];
  progress: { mine: { done: number; total: number }; team: { done: number; total: number } };
  grove: { team: { week: string; done: number; total: number }[]; mine: { week: string; done: number; total: number }[] };
  treeOff: boolean;
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SIZE_LABEL: Record<TaskSize, string> = { S: "S · quick", M: "M · an hour", L: "L · half a day" };
const fmtDue = (d: string, today: string) => {
  if (d < today) return `overdue (${short(d)})`;
  if (d === today) return "due today";
  return `due ${short(d)}`;
};
const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
const firstName = (n: string) => n.split(" ")[0] || n;

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "That didn't work. Try again.");
  return json;
}

function Tasks() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await call("/api/staff/tasks", "GET"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const change = async (id: string, patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await call(`/api/staff/tasks/${id}`, "PATCH", patch);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const tick = async (t: TaskOut) => {
    // Show it done at once; the server catches up.
    setData((d) => (d ? { ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, doneAt: new Date().toISOString() } : x)) } : d));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ id: t.id, title: t.title });
    undoTimer.current = setTimeout(() => setUndo(null), 10_000);
    await change(t.id, { done: true });
  };
  const undoTick = async () => {
    if (!undo) return;
    const id = undo.id;
    setUndo(null);
    await change(id, { done: false });
  };

  const byBand = useMemo(() => {
    const out: Record<Band, TaskOut[]> = { today: [], week: [], later: [] };
    for (const t of data?.tasks ?? []) if (!t.doneAt) out[t.band].push(t);
    for (const b of BANDS) out[b].sort((a, c) => (a.priority === c.priority ? a.position - c.position : a.priority === "high" ? -1 : 1));
    return out;
  }, [data]);
  const doneThisWeek = (data?.tasks ?? []).filter((t) => t.doneAt).sort((a, b) => (b.doneAt! > a.doneAt! ? 1 : -1));

  // Reorder: put `id` just before `beforeId` (or at the end of `band`).
  const place = async (id: string, band: Band, beforeId: string | null) => {
    const list = byBand[band].filter((t) => t.id !== id);
    const idx = beforeId ? list.findIndex((t) => t.id === beforeId) : list.length;
    const prev = list[idx - 1]?.position;
    const next = list[idx]?.position;
    const position = prev == null && next == null ? 1 : prev == null ? next! - 1 : next == null ? prev + 1 : (prev + next) / 2;
    await change(id, { band, position });
  };
  const move = async (t: TaskOut, dir: -1 | 1) => {
    const list = byBand[t.band];
    const i = list.findIndex((x) => x.id === t.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    await place(t.id, t.band, dir === -1 ? list[j].id : list[j + 1]?.id ?? null);
  };
  const onDrop = (band: Band, beforeId: string | null) => (e: DragEvent) => {
    e.preventDefault();
    const id = dragId.current;
    dragId.current = null;
    if (id && id !== beforeId) place(id, band, beforeId);
  };

  if (!data) {
    return (
      <DashboardShell title="Tasks">
        {error ? (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        ) : (
          <p className="secondary">Loading…</p>
        )}
      </DashboardShell>
    );
  }

  const minePct = percent(data.progress.mine);
  const teamPct = percent(data.progress.team);
  const myLoad = [...byBand.today, ...byBand.week].reduce((s, t) => s + TASK_SIZES[t.size], 0);
  const carried = [...byBand.today, ...byBand.week].filter((t) => t.createdAt.slice(0, 10) < data.monday && !t.repeating);

  return (
    <DashboardShell title="Tasks" lede="Your list for the week. Tick things off and watch the clinic tree grow.">
      <div className="tasks-layout">
        <div className="stack-5 tasks-main">
          {error && (
            <Notice tone="error">
              <p>{error}</p>
            </Notice>
          )}
          {undo && (
            <div className="tasks-undo" role="status">
              <span>Done: {undo.title}</span>
              <button className="btn btn-secondary" onClick={undoTick}>
                Undo
              </button>
            </div>
          )}

          <a className="btn btn-primary tasks-jump" href="#task-title">
            + New task
          </a>
          <AddTask data={data} busy={busy} onAdded={load} onError={setError} />

          {myLoad > NUDGE_POINTS && (
            <Notice tone="info" title="Your week looks full">
              <p>
                {myLoad} points are in Today and This week. Could something move to Later, or go to someone else? A short list is easier to finish.
              </p>
            </Notice>
          )}
          {carried.length > 0 && (
            <Notice tone="info" title={`${carried.length} task${carried.length === 1 ? "" : "s"} from last week`}>
              <p>Keep them, move them to Later, give them to someone else or drop them: open a task&apos;s details to choose. No harm done.</p>
            </Notice>
          )}

          {BANDS.map((band) => (
            <section key={band} aria-labelledby={`band-${band}`} className="tasks-band" onDragOver={(e) => e.preventDefault()} onDrop={onDrop(band, null)}>
              <h2 id={`band-${band}`}>
                {BAND_LABEL[band]} <span className="secondary">({byBand[band].length})</span>
              </h2>
              {byBand[band].length === 0 ? (
                <p className="secondary tasks-empty">{band === "today" ? "Nothing for today." : "Nothing here."}</p>
              ) : (
                <ol className="tasks-list">
                  {byBand[band].map((t, i) => (
                    <li
                      key={t.id}
                      className={`task${t.priority === "high" ? " is-high" : ""}`}
                      draggable
                      onDragStart={() => (dragId.current = t.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.stopPropagation();
                        onDrop(band, t.id)(e);
                      }}
                    >
                      <div className="task-row">
                        <label className="task-tick">
                          <input type="checkbox" checked={false} disabled={busy} onChange={() => tick(t)} />
                          <span className="visually-hidden">Mark done: {t.title}</span>
                        </label>
                        <div className="task-body">
                          <span className="task-title">{t.title}</span>
                          <span className="task-chips">
                            {t.priority === "high" && <span className="badge is-warn">High priority</span>}
                            <span className="badge" title={SIZE_LABEL[t.size]}>
                              {t.size}
                            </span>
                            {t.dueDay && <span className={`badge${t.dueDay <= data.today ? " is-warn" : ""}`}>{fmtDue(t.dueDay, data.today)}</span>}
                            {t.repeating && <span className="badge">Repeats</span>}
                            {t.createdBy !== data.me.id && <span className="badge">From {firstName(t.createdByName)}</span>}
                            {carried.includes(t) && <span className="badge">From last week</span>}
                          </span>
                        </div>
                        <div className="task-actions">
                          <button className="btn-icon task-arrow" aria-label={`Move up: ${t.title}`} disabled={busy || i === 0} onClick={() => move(t, -1)}>
                            ↑
                          </button>
                          <button className="btn-icon task-arrow" aria-label={`Move down: ${t.title}`} disabled={busy || i === byBand[band].length - 1} onClick={() => move(t, 1)}>
                            ↓
                          </button>
                          <button className="btn-icon" aria-expanded={open === t.id} aria-label={`Details: ${t.title}`} onClick={() => setOpen(open === t.id ? null : t.id)}>
                            ⋯
                          </button>
                        </div>
                      </div>
                      {open === t.id && <TaskDetails t={t} data={data} busy={busy} change={change} onMove={(dir) => move(t, dir)} first={i === 0} last={i === byBand[band].length - 1} />}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}

          {doneThisWeek.length > 0 && (
            <details className="panel">
              <summary>Done this week ({doneThisWeek.length})</summary>
              <ul className="tasks-done">
                {doneThisWeek.map((t) => (
                  <li key={t.id}>
                    <span>✓ {t.title}</span>
                    <button className="btn btn-secondary" disabled={busy} onClick={() => change(t.id, { done: false })}>
                      Not done
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <Given data={data} />
          <Repeating data={data} busy={busy} onChanged={load} onError={setError} />

          <p className="secondary tasks-purpose tasks-after-add">
            Tasks help us see, share and finish the week&apos;s work together. They are not used for appraisal. Only you see your own list and your own tree; the
            clinic tree shows the team&apos;s total, never anyone&apos;s name.
          </p>
        </div>

        <aside className="tasks-side stack-5" aria-label="Trees">
          {data.treeOff ? (
            <div className="panel">
              <p className="secondary">
                This week: {data.progress.mine.done} of {data.progress.mine.total} points done ({minePct}%).
              </p>
              <button className="btn btn-secondary" onClick={() => call("/api/staff/tasks/prefs", "PATCH", { treeOff: false }).then(load)}>
                Show the trees
              </button>
            </div>
          ) : (
            <>
              <section className="panel tree-panel" aria-labelledby="tree-team">
                <h2 id="tree-team">The clinic tree</h2>
                <TreeSvg pct={teamPct} label="The clinic tree" />
                <p className="tree-caption">
                  <strong>{teamPct}%</strong> of the team&apos;s week done · {STAGE_LABEL[treeStage(teamPct)]}
                </p>
                {teamPct >= 100 && <p className="tree-caption">In full blossom. Thank you, everyone.</p>}
              </section>
              <section className="panel tree-panel" aria-labelledby="tree-mine">
                <h2 id="tree-mine">Your tree</h2>
                <p className="secondary">Only you can see this.</p>
                <TreeSvg pct={minePct} size={130} label="Your tree" />
                <p className="tree-caption">
                  {data.progress.mine.done} of {data.progress.mine.total} points · <strong>{minePct}%</strong>
                </p>
              </section>
              <section className="panel" aria-labelledby="grove">
                <h2 id="grove">The grove</h2>
                <p className="secondary">Each finished week, planted at the size it reached. Nothing withers.</p>
                <Grove weeks={data.grove.team} label="The clinic's past weeks" />
              </section>
              <button className="btn btn-secondary" onClick={() => call("/api/staff/tasks/prefs", "PATCH", { treeOff: true }).then(load)}>
                Hide the trees
              </button>
            </>
          )}
        </aside>
      </div>
    </DashboardShell>
  );
}

function AddTask({ data, busy, onAdded, onError }: { data: Data; busy: boolean; onAdded: () => void; onError: (m: string) => void }) {
  const [title, setTitle] = useState("");
  const [who, setWho] = useState(data.me.id);
  const [size, setSize] = useState<TaskSize>("M");
  const [band, setBand] = useState<Band>("week");
  const [due, setDue] = useState("");
  const [high, setHigh] = useState(false);
  const [saving, setSaving] = useState(false);
  const person = data.people.find((p) => p.id === who);
  const heavy = person && who !== data.me.id && band !== "later" && person.openPoints + TASK_SIZES[size] > NUDGE_POINTS;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await call("/api/staff/tasks", "POST", { title, assigneeId: who, size, band, dueDay: due || null, priority: (high ? "high" : "normal") as Priority });
      setTitle("");
      setDue("");
      setHigh(false);
      onAdded();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="panel tasks-add" onSubmit={submit}>
      <div className="field">
        <label htmlFor="task-title">New task</label>
        <input id="task-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Order gloves" autoComplete="off" />
        <p className="field-hint">No patient names: use a Cliniko link or reference instead.</p>
      </div>
      <div className="tasks-add-row">
        <div className="field">
          <label htmlFor="task-who">For</label>
          <select id="task-who" value={who} onChange={(e) => setWho(e.target.value)}>
            {data.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === data.me.id ? "Me" : p.name} · {p.openPoints} pts
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="task-band">When</label>
          <select id="task-band" value={band} onChange={(e) => setBand(e.target.value as Band)}>
            {BANDS.map((b) => (
              <option key={b} value={b}>
                {BAND_LABEL[b]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="task-size">Size</label>
          <select id="task-size" value={size} onChange={(e) => setSize(e.target.value as TaskSize)}>
            {(Object.keys(TASK_SIZES) as TaskSize[]).map((s) => (
              <option key={s} value={s}>
                {SIZE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="task-due">Due (optional)</label>
          <input id="task-due" type="date" value={due} min={data.today} onChange={(e) => setDue(e.target.value)} />
        </div>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={high} onChange={(e) => setHigh(e.target.checked)} />
        <span>High priority (goes to the top of its list)</span>
      </label>
      {heavy && (
        <p className="field-hint" role="status">
          {firstName(person!.name)} already has {person!.openPoints} points this week. Maybe put it in Later, or check with them.
        </p>
      )}
      <div className="row-actions">
        <button className="btn btn-primary" type="submit" disabled={busy || saving || !title.trim()}>
          {saving ? "Adding…" : who === data.me.id ? "Add task" : `Give to ${firstName(person?.name ?? "")}`}
        </button>
      </div>
    </form>
  );
}

function TaskDetails({
  t,
  data,
  busy,
  change,
  onMove,
  first,
  last,
}: {
  t: TaskOut;
  data: Data;
  busy: boolean;
  change: (id: string, p: Record<string, unknown>) => Promise<void>;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  return (
    <div className="task-details">
      <div className="tasks-add-row">
        <div className="field">
          <label htmlFor={`band-${t.id}`}>Move to</label>
          <select id={`band-${t.id}`} value={t.band} disabled={busy} onChange={(e) => change(t.id, { band: e.target.value, position: Date.now() / 1e9 })}>
            {BANDS.map((b) => (
              <option key={b} value={b}>
                {BAND_LABEL[b]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`who-${t.id}`}>Give to</label>
          <select id={`who-${t.id}`} value={t.assigneeId} disabled={busy} onChange={(e) => change(t.id, { assigneeId: e.target.value })}>
            {data.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === data.me.id ? "Me" : p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`size-${t.id}`}>Size</label>
          <select id={`size-${t.id}`} value={t.size} disabled={busy} onChange={(e) => change(t.id, { size: e.target.value })}>
            {(Object.keys(TASK_SIZES) as TaskSize[]).map((s) => (
              <option key={s} value={s}>
                {SIZE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`due-${t.id}`}>Due</label>
          <input id={`due-${t.id}`} type="date" value={t.dueDay ?? ""} disabled={busy} onChange={(e) => change(t.id, { dueDay: e.target.value || null })} />
        </div>
      </div>
      <div className="row-actions">
        <button className="btn btn-secondary task-move" disabled={busy || first} onClick={() => onMove(-1)}>
          Move up
        </button>
        <button className="btn btn-secondary task-move" disabled={busy || last} onClick={() => onMove(1)}>
          Move down
        </button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => change(t.id, { priority: t.priority === "high" ? "normal" : "high" })}>
          {t.priority === "high" ? "Not high priority" : "Make high priority"}
        </button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => window.confirm(`Drop "${t.title}"? It comes off the list and doesn't count against the week.`) && change(t.id, { dropped: true })}>
          Drop task
        </button>
      </div>
      {t.createdBy !== data.me.id && <p className="secondary">Given by {t.createdByName}.</p>}
    </div>
  );
}

function Given({ data }: { data: Data }) {
  if (!data.given.length) return null;
  return (
    <details className="panel">
      <summary>Given to others ({data.given.length})</summary>
      <ul className="tasks-done">
        {data.given.map((t) => (
          <li key={t.id}>
            <span>
              {t.doneAt ? "✓ " : ""}
              {t.title} · {t.assigneeName}
            </span>
            <span className="secondary">{t.doneAt ? "Done" : BAND_LABEL[t.band]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Repeating({ data, busy, onChanged, onError }: { data: Data; busy: boolean; onChanged: () => void; onError: (m: string) => void }) {
  const [title, setTitle] = useState("");
  const [who, setWho] = useState(data.me.id);
  const [size, setSize] = useState<TaskSize>("M");
  const [kind, setKind] = useState<"weekly" | "monthly">("weekly");
  const [weekday, setWeekday] = useState(0);
  const [day, setDay] = useState(29);
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const rule: TaskRule = kind === "weekly" ? { kind, weekday } : { kind, day };
      await call("/api/staff/tasks/templates", "POST", { title, assigneeId: who, size, priority: "normal", rule });
      setTitle("");
      onChanged();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const stop = async (t: TemplateOut) => {
    if (!window.confirm(`Stop "${t.title}"? No more will be added, and upcoming ones come off the list.`)) return;
    try {
      await call(`/api/staff/tasks/templates/${t.id}`, "DELETE");
      onChanged();
    } catch (err: any) {
      onError(err.message);
    }
  };
  return (
    <details className="panel tasks-after-add">
      <summary>Repeating tasks ({data.templates.length})</summary>
      <p className="secondary">
        They appear on the list by themselves before they&apos;re due. A weekend or bank holiday moves one to the working day before; a day the month doesn&apos;t have
        (like the 31st) means its last day.
      </p>
      {data.templates.length > 0 && (
        <ul className="tasks-done">
          {data.templates.map((t) => (
            <li key={t.id}>
              <span>
                {t.title} · {ruleLabel(t.rule)} · {t.assigneeId === data.me.id ? "me" : t.assigneeName} · {t.size}
              </span>
              {(t.createdBy === data.me.id || t.assigneeId === data.me.id || data.me.manager) && (
                <button className="btn btn-secondary" disabled={busy} onClick={() => stop(t)}>
                  Stop
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="stack-4" onSubmit={submit}>
        <div className="field">
          <label htmlFor="rep-title">New repeating task</label>
          <input id="rep-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Run payroll" autoComplete="off" />
        </div>
        <div className="tasks-add-row">
          <div className="field">
            <label htmlFor="rep-who">For</label>
            <select id="rep-who" value={who} onChange={(e) => setWho(e.target.value)}>
              {data.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === data.me.id ? "Me" : p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rep-kind">Repeats</label>
            <select id="rep-kind" value={kind} onChange={(e) => setKind(e.target.value as "weekly" | "monthly")}>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </div>
          {kind === "weekly" ? (
            <div className="field">
              <label htmlFor="rep-weekday">On</label>
              <select id="rep-weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((w, i) => (
                  <option key={w} value={i}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="rep-day">Day of the month</label>
              <input id="rep-day" type="number" min={1} max={31} value={day} onChange={(e) => setDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} />
            </div>
          )}
          <div className="field">
            <label htmlFor="rep-size">Size</label>
            <select id="rep-size" value={size} onChange={(e) => setSize(e.target.value as TaskSize)}>
              {(Object.keys(TASK_SIZES) as TaskSize[]).map((s) => (
                <option key={s} value={s}>
                  {SIZE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row-actions">
          <button className="btn btn-primary" type="submit" disabled={saving || !title.trim()}>
            {saving ? "Saving…" : "Add repeating task"}
          </button>
        </div>
      </form>
    </details>
  );
}
