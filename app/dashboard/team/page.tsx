"use client";

import { useCallback, useEffect, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { ROLES, ROLE_LABEL, type Role } from "@/core/roles";
import { TASK_ROLES, type TaskRole } from "@/core/features";

/**
 * Team: owners and super admins add staff, change roles, switch accounts off
 * and reset sign-in. The rules (only owners touch owners and super admins,
 * never zero owners, nobody changes themselves) are enforced on the server
 * in core/roles.ts; this page explains them.
 */

type Row = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  clinikoPractitionerId: string | null;
  passkeys: number;
  computers: number;
  waitingDevices: { id: string; name: string; createdAt: string; kind?: "face_id" | "computer" }[];
  timesheets: boolean;
  deviceApprover: boolean;
};
type Practitioner = { id: string; name: string };

const ROLE_HELP: Record<Role, string> = {
  therapist: "Guides for patients and therapists. Their own diary and payments later.",
  admin: "Reception: bookings, phone bookings, refunds, extras, pausing online booking.",
  owner: "Everything, including adding and removing anyone.",
  superadmin: "Technical support: everything except changing owners.",
};

export default function TeamPage() {
  return (
    <StaffGate permission="staff:manage" title="Team">
      {() => <Team />}
    </StaffGate>
  );
}

function Team() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [me, setMe] = useState<{ id: string; role: Role } | null>(null);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/staff/team", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? "Couldn't load the team.");
    setRows(data.staff);
    setMe({ id: data.me, role: data.myRole });
  }, []);

  useEffect(() => {
    load();
    fetch("/api/staff/practitioners")
      .then((r) => r.json())
      .then((d) => setPractitioners(d.practitioners ?? []))
      .catch(() => {});
  }, [load]);

  async function call(id: string, url: string, method: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "That didn't work.");
      else setNotice(data.message ?? "Saved.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  const canTouch = (r: Row) => me && r.id !== me.id && (me.role === "owner" || (r.role !== "owner" && r.role !== "superadmin"));
  const assignable = ROLES.filter((r) => me?.role === "owner" || (r !== "owner" && r !== "superadmin"));
  const practitionerName = (id: string | null) => practitioners.find((p) => p.id === id)?.name ?? (id ? `Cliniko ID ${id}` : "");

  return (
    <DashboardShell title="Team" lede="Everyone who can sign in to the dashboard. Changes take effect straight away, and every change is logged.">
      <div className="stack-5">
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

        <AddPerson assignable={assignable} practitioners={practitioners} onAdded={load} setError={setError} setNotice={setNotice} />
        <AddSeveral assignable={assignable} onAdded={load} setError={setError} setNotice={setNotice} />

        {!rows && <p className="secondary">Loading…</p>}
        {rows?.map((r) => (
          <section key={r.id} className="panel stack-3" aria-labelledby={`staff-${r.id}`}>
            <h2 id={`staff-${r.id}`} className="panel-title">
              {r.name} {r.id === me?.id && <span className="badge">You</span>} {!r.active && <span className="badge is-bad">Switched off</span>}
            </h2>
            <p className="secondary">
              {r.email} · {ROLE_LABEL[r.role]}
              {r.role === "therapist" && r.clinikoPractitionerId ? ` · ${practitionerName(r.clinikoPractitionerId)}` : ""} ·{" "}
              {r.passkeys === 0 && r.computers === 0
                ? "No approved device yet"
                : [
                    r.computers > 0 ? `${r.computers} approved computer${r.computers === 1 ? "" : "s"}` : "",
                    r.passkeys > 0 ? `Face ID on ${r.passkeys} device${r.passkeys === 1 ? "" : "s"}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
              {r.waitingDevices.length ? ` · ${r.waitingDevices.length} waiting` : ""}
              {r.timesheets ? " · Timesheets on" : ""}
              {r.deviceApprover ? " · Approves new devices" : ""}
            </p>
            {canTouch(r) &&
              r.waitingDevices.map((d) => (
                <div key={d.id} className="notice is-warning">
                  <div className="notice-body">
                    <p className="notice-title">New device waiting: {d.name}</p>
                    <p>
                      {d.kind === "computer" ? "Signed in with an emailed code from a new computer or phone on" : "Face ID set up with an emailed code on"}{" "}
                      {new Date(d.createdAt).toLocaleString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. Check
                      with {r.name.split(" ")[0]} it was them before approving.
                    </p>
                    <div className="actions">
                      <button
                        className="btn btn-secondary"
                        disabled={busy === r.id}
                        onClick={() => call(r.id, `/api/staff/devices/${d.id}/approve`, "POST", undefined, `Approve ${r.name}'s ${d.name}? Only if they've told you it's theirs. It will then be able to sign in with ${d.kind === "computer" ? "an emailed code" : "Face ID"}.`)}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-destructive"
                        disabled={busy === r.id}
                        onClick={() => call(r.id, `/api/staff/devices/${d.id}/reject`, "POST", undefined, `Remove ${r.name}'s ${d.name}? Their emailed-code sign-ins end too.`)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            {r.active && (r.id === me?.id || canTouch(r)) && (
              <div className="actions">
                <button
                  className="btn btn-secondary"
                  disabled={busy === r.id}
                  onClick={() =>
                    call(
                      r.id,
                      `/api/staff/team/${r.id}/timesheets`,
                      "PATCH",
                      { enabled: !r.timesheets },
                      r.timesheets ? `Switch timesheets off for ${r.name}? Their past entries are kept.` : undefined
                    )
                  }
                >
                  {r.timesheets ? "Switch timesheets off" : "Switch timesheets on"}
                </button>
                {r.role === "admin" && canTouch(r) && (
                  <button
                    className="btn btn-secondary"
                    disabled={busy === r.id}
                    onClick={() =>
                      call(
                        r.id,
                        `/api/staff/team/${r.id}/device-approver`,
                        "PATCH",
                        { enabled: !r.deviceApprover },
                        r.deviceApprover
                          ? `Stop ${r.name} approving other people's new devices?`
                          : `Let ${r.name} approve new phones and computers for therapists and reception? They'll see them on their dashboard home. Not for owners or super admins.`
                      )
                    }
                  >
                    {r.deviceApprover ? "Stop approving devices" : "Can approve new devices"}
                  </button>
                )}
              </div>
            )}
            {canTouch(r) ? (
              <div className="actions">
                <label className="visually-hidden" htmlFor={`role-${r.id}`}>
                  Role for {r.name}
                </label>
                <select
                  className="select-inline"
                  id={`role-${r.id}`}
                  value={r.role}
                  disabled={busy === r.id}
                  onChange={(e) =>
                    call(r.id, `/api/staff/team/${r.id}`, "PATCH", { role: e.target.value }, `Change ${r.name} to ${ROLE_LABEL[e.target.value as Role]}? They'll be signed out and sign in again.`)
                  }
                >
                  {assignable.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary"
                  disabled={busy === r.id}
                  onClick={() => {
                    const name = window.prompt(`New name for ${r.name}`, r.name)?.trim();
                    if (name && name !== r.name) call(r.id, `/api/staff/team/${r.id}`, "PATCH", { name });
                  }}
                >
                  Rename
                </button>
                {r.active ? (
                  <button
                    className="btn btn-destructive"
                    disabled={busy === r.id}
                    onClick={() =>
                      call(r.id, `/api/staff/team/${r.id}`, "PATCH", { active: false }, `Switch off ${r.name}'s account? They'll be signed out everywhere at once.`)
                    }
                  >
                    Switch off
                  </button>
                ) : (
                  <button className="btn btn-secondary" disabled={busy === r.id} onClick={() => call(r.id, `/api/staff/team/${r.id}`, "PATCH", { active: true })}>
                    Switch back on
                  </button>
                )}
                {(r.passkeys > 0 || r.computers > 0) && (
                  <button
                    className="btn btn-secondary"
                    disabled={busy === r.id}
                    onClick={() =>
                      call(
                        r.id,
                        `/api/staff/team/${r.id}/reset-passkeys`,
                        "POST",
                        undefined,
                        `Reset ${r.name}'s sign-in? Use this for a lost phone or computer, and only after checking with them. All their approved phones and computers are removed. The next one they sign in on with an emailed code is approved automatically.`
                      )
                    }
                  >
                    Reset sign-in
                  </button>
                )}
              </div>
            ) : r.id === me?.id ? (
              r.active && (
                <div className="actions">
                  <button
                    className="btn btn-secondary"
                    disabled={busy === r.id}
                    onClick={() => {
                      const name = window.prompt("Your new name", r.name)?.trim();
                      if (name && name !== r.name) call(r.id, `/api/staff/team/${r.id}`, "PATCH", { name });
                    }}
                  >
                    Rename yourself
                  </button>
                </div>
              )
            ) : (
              <p className="secondary">Only an owner can change an owner or super admin.</p>
            )}
          </section>
        ))}

        <FeatureSwitches setError={setError} setNotice={setNotice} />

        <Notice title="The rules">
          <ul>
            {ROLES.map((r) => (
              <li key={r}>
                <strong>{ROLE_LABEL[r]}:</strong> {ROLE_HELP[r]}
              </li>
            ))}
            <li>There is always at least one owner, and nobody can change their own access.</li>
          </ul>
        </Notice>
      </div>
    </DashboardShell>
  );
}

function AddPerson({
  assignable,
  practitioners,
  onAdded,
  setError,
  setNotice,
}: {
  assignable: Role[];
  practitioners: Practitioner[];
  onAdded: () => void;
  setError: (s: string | null) => void;
  setNotice: (s: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("therapist");
  const [practitioner, setPractitioner] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <div>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          Add someone
        </button>
      </div>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/staff/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, clinikoPractitionerId: role === "therapist" ? practitioner : null }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "Couldn't add them.");
      setNotice(data.message);
      setOpen(false);
      setName("");
      setEmail("");
      setPractitioner("");
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  const ready = name.trim() && email.includes("@") && (role !== "therapist" || practitioner);
  return (
    <form
      className="panel stack-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) submit();
      }}
    >
      <h2 className="panel-title">Add someone</h2>
      <div className="field">
        <label htmlFor="new-name">Full name</label>
        <input id="new-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="new-email">Work email</label>
        <input id="new-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="new-role">Role</label>
        <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {assignable.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <p className="field-hint">{ROLE_HELP[role]}</p>
      </div>
      {role === "therapist" && (
        <div className="field">
          <label htmlFor="new-practitioner">Their name in Cliniko</label>
          <p className="field-hint">So they only ever see their own patients.</p>
          <select id="new-practitioner" value={practitioner} onChange={(e) => setPractitioner(e.target.value)}>
            <option value="">Choose…</option>
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="secondary">We&apos;ll email them how to sign in. Nobody can join without being added here.</p>
      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={!ready || busy}>
          {busy ? "Adding…" : "Add and email them"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type ImportRow = {
  line: number;
  name: string;
  email: string;
  role: Role | null;
  clinikoPractitionerId: string | null;
  practitionerName: string | null;
  status: "ready" | "skip" | "problem" | "added" | "failed";
  note?: string;
};

const STATUS_LABEL: Record<ImportRow["status"], string> = {
  ready: "Ready",
  skip: "Skipped",
  problem: "Needs a choice",
  added: "Added",
  failed: "Not added",
};

/**
 * Paste a list (one person per line: name, email, role), check it, fix any
 * line it couldn't work out, then add everyone. Therapists are matched to
 * their Cliniko name automatically where the name is clear.
 */
function AddSeveral({
  assignable,
  onAdded,
  setError,
  setNotice,
}: {
  assignable: Role[];
  onAdded: () => void;
  setError: (s: string | null) => void;
  setNotice: (s: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [decisions, setDecisions] = useState<Record<string, { role?: Role; clinikoPractitionerId?: string }>>({});
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <div>
        <button className="btn btn-secondary" onClick={() => setOpen(true)}>
          Add several people
        </button>
      </div>
    );
  }

  async function send(confirm: boolean, nextDecisions = decisions) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/staff/team/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, confirm, decisions: nextDecisions }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "Couldn't check the list.");
      setRows(data.rows);
      setPractitioners(data.practitioners ?? []);
      if (confirm) {
        setNotice(`Added ${data.added} ${data.added === 1 ? "person" : "people"} and emailed them how to sign in.`);
        onAdded();
      }
    } finally {
      setBusy(false);
    }
  }

  function decide(email: string, change: { role?: Role; clinikoPractitionerId?: string }) {
    const next = { ...decisions, [email]: { ...decisions[email], ...change } };
    setDecisions(next);
    send(false, next);
  }

  const ready = rows?.filter((r) => r.status === "ready").length ?? 0;
  const problems = rows?.filter((r) => r.status === "problem").length ?? 0;
  const done = rows?.some((r) => r.status === "added" || r.status === "failed");

  return (
    <section className="panel stack-3" aria-labelledby="add-several">
      <h2 id="add-several" className="panel-title">
        Add several people
      </h2>
      <div className="field">
        <label htmlFor="several-text">One person per line: name, email, role</label>
        <p className="field-hint">For example: Sarah Byrne, sarah@example.com, therapist. Roles: therapist, reception, owner, super admin.</p>
        <textarea
          id="several-text"
          rows={8}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setRows(null);
          }}
        />
      </div>
      {!done && (
        <div className="actions">
          <button className="btn btn-secondary" disabled={busy || !text.trim()} onClick={() => send(false)}>
            {busy && !rows ? "Checking…" : "Check the list"}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
      {rows && (
        <>
          <ul className="plain-list stack-3">
            {rows.map((r) => (
              <li key={`${r.line}-${r.email}`} className="import-row">
                <p>
                  <strong>{r.name || "(no name)"}</strong> · {r.email || "(no email)"}{" "}
                  <span className={`badge ${r.status === "ready" || r.status === "added" ? "is-good" : r.status === "skip" ? "" : "is-warn"}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </p>
                <p className="secondary">
                  {[r.role && ROLE_LABEL[r.role], r.practitionerName && `Cliniko: ${r.practitionerName}`, r.note].filter(Boolean).join(" · ")}
                </p>
                {r.status === "problem" && r.email && (
                  <div className="actions">
                    {!r.role && (
                      <select className="select-inline" aria-label={`Role for ${r.name}`} value="" onChange={(e) => decide(r.email, { role: e.target.value as Role })}>
                        <option value="">Choose a role…</option>
                        {assignable.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                    )}
                    {r.role === "therapist" && !r.clinikoPractitionerId && (
                      <select
                        className="select-inline"
                        aria-label={`Cliniko name for ${r.name}`}
                        value=""
                        onChange={(e) => decide(r.email, { clinikoPractitionerId: e.target.value })}
                      >
                        <option value="">Their name in Cliniko…</option>
                        {practitioners.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!done && (
            <div className="actions">
              <button className="btn btn-primary" disabled={busy || ready === 0 || problems > 0} onClick={() => send(true)}>
                {busy ? "Adding…" : `Add ${ready} ${ready === 1 ? "person" : "people"} and email them`}
              </button>
              {problems > 0 && <p className="secondary">Choose for the {problems} line{problems === 1 ? "" : "s"} marked "Needs a choice" first.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Owners and super admins: which roles have the Tasks tab (core/features.ts). */
function FeatureSwitches({ setError, setNotice }: { setError: (m: string) => void; setNotice: (m: string) => void }) {
  const [tasks, setTasks] = useState<Record<TaskRole, boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/staff/features", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.tasks && setTasks(j.tasks))
      .catch(() => {});
  }, []);
  if (!tasks) return null;
  const toggle = async (role: TaskRole) => {
    const next = { ...tasks, [role]: !tasks[role] };
    setSaving(true);
    try {
      const res = await fetch("/api/staff/features", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tasks: next }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Couldn't change that.");
      setTasks(j.tasks);
      setNotice(`Tasks ${j.tasks[role] ? "switched on" : "switched off"} for ${ROLE_LABEL[role]}.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="panel stack-3" aria-labelledby="features-title">
      <h2 id="features-title" className="panel-title">
        Tasks tab
      </h2>
      <p className="panel-meta">
        Who has the Tasks tab and the clinic tree. Switched off, the tile and page disappear for that role; nobody&apos;s tasks are deleted. Therapists never
        have it.
      </p>
      {TASK_ROLES.map((r) => (
        <label key={r} className="checkbox">
          <input type="checkbox" checked={tasks[r]} disabled={saving} onChange={() => toggle(r)} />
          <span>{ROLE_LABEL[r]}</span>
        </label>
      ))}
    </section>
  );
}
