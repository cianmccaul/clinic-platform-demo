"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { TimePicker } from "@/components/TimePicker";
import { euro, formatDublin } from "@/core/policy";
import { dayLong, whenLong, whenShort } from "@/core/format";

/**
 * Appointments (clinic issues 2 and 4, 3 Nov 2026): find any patient and
 * move or cancel their appointments here, whether they were booked online,
 * by phone or straight into Cliniko. Also the payments kept for a new time
 * when the time someone paid for had gone (lib/rebook.ts).
 */
export default function AppointmentsPage() {
  return (
    <StaffGate permission="bookings:manage" title="Appointments">
      {() => <Appointments />}
    </StaffGate>
  );
}

type Rebook = {
  id: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  practitionerName: string;
  appointmentTypeName: string;
  amountMinor: number;
  originalStartsAtISO: string;
  refundBy: string;
  businessId: string;
  practitionerId: string;
  appointmentTypeId: string;
};
type Found = { id: string; name: string; dateOfBirth: string | null; next: { startsAtISO: string; practitionerName?: string; treatment?: string } | null };
type Appt = {
  appointmentId: string;
  startsAtISO: string;
  durationMinutes: number;
  practitionerId: string;
  practitionerName: string;
  appointmentTypeId: string;
  appointmentTypeName: string;
  businessId: string;
  hub: { netPaidMinor: number; voucherMinor: number; owedMinor: number } | null;
};
type PatientAppts = { patient: { id: string; name: string; email: string }; hasSavedCard: boolean; appointments: Appt[] };
type Result = { ok: boolean; text: string };

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function Appointments() {
  const [rebooks, setRebooks] = useState<Rebook[] | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<PatientAppts | null>(null);
  const [loadingPatient, setLoadingPatient] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; kind: "move" | "cancel" | "rebook" } | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, Result>>({});
  const listRef = useRef<HTMLHeadingElement>(null);

  const loadRebooks = useCallback(async () => {
    const res = await fetch("/api/admin/appointments?rebooks=1", { cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    if (res.ok) setRebooks(d.rebooks ?? []);
  }, []);
  useEffect(() => {
    loadRebooks();
  }, [loadRebooks]);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (q.trim().length < 3) return setSearchNote("Type at least 3 letters of the surname, or their date of birth (e.g. 14/03/1985).");
    setSearching(true);
    setSearchNote(null);
    setError(null);
    setChosen(null);
    const { ok, data } = await post("/api/admin/patient-lookup", { action: "search", q: q.trim() });
    setSearching(false);
    if (!ok) return setError(data.error ?? "Couldn't search Cliniko just now.");
    setFound(data.results ?? []);
    if (data.notSearchable) setSearchNote(data.notSearchable);
    else if (!data.results?.length) setSearchNote("No one found. Try the surname only, or their date of birth.");
    else if (data.more) setSearchNote("More people match: add their first name or date of birth to narrow it down.");
  }

  async function openPatient(id: string) {
    setLoadingPatient(true);
    setError(null);
    setOpen(null);
    setResult({});
    try {
      const res = await fetch(`/api/admin/appointments?patientId=${id}`, { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d.error ?? "Couldn't load their appointments.");
      setChosen(d);
      setTimeout(() => listRef.current?.focus(), 0);
    } finally {
      setLoadingPatient(false);
    }
  }

  const say = (id: string, r: Result) => setResult((m) => ({ ...m, [id]: r }));

  async function act(rowId: string, url: string, body: unknown, after: () => Promise<void>) {
    setBusy(true);
    say(rowId, { ok: true, text: "Working…" });
    const { ok, data } = await post(url, body);
    setBusy(false);
    if (!ok) {
      say(rowId, { ok: false, text: data.error ?? "That didn't work. Check Cliniko before trying again." });
      if (data.code === "slot_taken") setTime(null);
      return;
    }
    setOpen(null);
    setTime(null);
    await after();
    say(rowId, { ok: true, text: data.message ?? "Done." });
  }

  const refreshPatient = async () => {
    if (chosen) {
      const res = await fetch(`/api/admin/appointments?patientId=${chosen.patient.id}`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (res.ok && d) setChosen(d);
    }
  };

  return (
    <DashboardShell
      title="Appointments"
      lede="Find a patient, then move or cancel any of their appointments here: booked online, by phone or straight into Cliniko. To book a new one, use Book a patient by phone."
    >
      <div className="stack-5">
        {rebooks && rebooks.length > 0 && (
          <section aria-labelledby="rebooks-h" className="stack-4">
            <h2 id="rebooks-h">Paid, waiting for a new time ({rebooks.length})</h2>
            <p className="secondary">
              These patients paid, but their time was taken just before the payment went through. They&apos;ve been emailed a link to pick
              another time. If they ring, book a time for them here: no new payment is needed. Anything not booked by the date shown is
              refunded automatically.
            </p>
            {rebooks.map((r) => (
              <section key={r.id} className="panel">
                <h3 className="panel-title">{r.patientName}</h3>
                <p className="panel-meta">
                  {r.appointmentTypeName} with {r.practitionerName} · paid {euro(r.amountMinor)} · wanted {whenShort(r.originalStartsAtISO)}
                </p>
                <p className="panel-meta">
                  {r.patientEmail}
                  {r.patientPhone ? ` · ${r.patientPhone}` : ""} · refunded automatically on {dayLong(r.refundBy)} if not booked
                </p>
                <p className={result[r.id]?.ok === false ? "field-error" : "secondary"} role="status" aria-live="polite">
                  {result[r.id]?.text ?? ""}
                </p>
                {open?.id === r.id && open.kind === "rebook" ? (
                  <div className="panel-form stack-4">
                    <h4>Pick a time with {r.practitionerName}</h4>
                    <TimePicker businessId={r.businessId} practitionerId={r.practitionerId} appointmentTypeId={r.appointmentTypeId} value={time} onChange={setTime} />
                    <div className="row-actions">
                      <button
                        className="btn btn-primary"
                        disabled={busy || !time}
                        onClick={() => act(r.id, "/api/admin/appointments", { action: "rebook_book", id: r.id, startsAtISO: time }, loadRebooks)}
                      >
                        {time ? `Book ${whenLong(time)}` : "Choose a time"}
                      </button>
                      <button className="btn btn-secondary" disabled={busy} onClick={() => setOpen(null)}>
                        Back
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row-actions">
                    <button className="btn btn-primary" disabled={busy} onClick={() => { setTime(null); setOpen({ id: r.id, kind: "rebook" }); }}>
                      Book a time
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => window.confirm(`Refund ${euro(r.amountMinor)} to ${r.patientName} instead? No appointment will be booked.`) && act(r.id, "/api/admin/appointments", { action: "rebook_refund", id: r.id }, loadRebooks)}
                    >
                      Refund {euro(r.amountMinor)}
                    </button>
                  </div>
                )}
              </section>
            ))}
          </section>
        )}

        <section aria-labelledby="find-h" className="stack-4">
          <h2 id="find-h">Find a patient</h2>
          <form className="inline-form" onSubmit={search}>
            <div className="field">
              <label htmlFor="appt-q">Surname, full name or date of birth</label>
              <input id="appt-q" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            </div>
            <button className="btn btn-primary" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </form>
          {searchNote && <p className="secondary">{searchNote}</p>}
          {error && (
            <Notice tone="error" title="Couldn't do that">
              <p>{error}</p>
            </Notice>
          )}
          {found && found.length > 0 && !chosen && (
            <ul className="option-list">
              {found.map((p) => (
                <li key={p.id}>
                  <button className="option" disabled={loadingPatient} onClick={() => openPatient(p.id)}>
                    <span className="option-main">
                      <span className="option-title">{p.name}</span>
                      <span className="option-facts">
                        {p.dateOfBirth ? `Born ${p.dateOfBirth.split("-").reverse().join("/")}` : "No date of birth"}
                        {p.next ? ` · next: ${whenShort(p.next.startsAtISO)}${p.next.practitionerName ? ` with ${p.next.practitionerName}` : ""}` : " · nothing booked"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loadingPatient && <p className="secondary">Loading their appointments…</p>}
        </section>

        {chosen && (
          <section aria-labelledby="pt-h" className="stack-4">
            <h2 id="pt-h" ref={listRef} tabIndex={-1}>
              {chosen.patient.name}: upcoming appointments
            </h2>
            <p className="row-actions">
              <button className="btn btn-secondary" onClick={() => setChosen(null)}>
                Back to the results
              </button>
              <a className="btn btn-secondary" href="/dashboard/book">
                Book a new appointment
              </a>
            </p>
            {chosen.appointments.length === 0 && <p className="secondary">Nothing booked from today on.</p>}
            {chosen.appointments.map((a) => {
              const paid = a.hub ? a.hub.netPaidMinor + a.hub.voucherMinor : 0;
              return (
                <section key={a.appointmentId} className="panel">
                  <h3 className="panel-title">{whenLong(a.startsAtISO)}</h3>
                  <p className="panel-meta">
                    {a.appointmentTypeName} with {a.practitionerName} · {a.durationMinutes} min
                  </p>
                  <div className="badge-row">
                    {a.hub ? <span className="badge is-good">Paid {euro(paid)} through the Hub</span> : <span className="badge">Nothing paid through the Hub</span>}
                  </div>
                  <p className={result[a.appointmentId]?.ok === false ? "field-error" : "secondary"} role="status" aria-live="polite">
                    {result[a.appointmentId]?.text ?? ""}
                  </p>
                  {open?.id === a.appointmentId && open.kind === "move" ? (
                    <div className="panel-form stack-4">
                      <h4>New time with {a.practitionerName}</h4>
                      <TimePicker
                        businessId={a.businessId}
                        practitionerId={a.practitionerId}
                        appointmentTypeId={a.appointmentTypeId}
                        excludeAppointmentId={a.appointmentId}
                        value={time}
                        onChange={setTime}
                      />
                      <div className="row-actions">
                        <button
                          className="btn btn-primary"
                          disabled={busy || !time}
                          onClick={() => act(a.appointmentId, "/api/admin/appointments", { action: "move", appointmentId: a.appointmentId, startsAtISO: time }, refreshPatient)}
                        >
                          {time ? `Move to ${whenLong(time)}` : "Choose a time"}
                        </button>
                        <button className="btn btn-secondary" disabled={busy} onClick={() => setOpen(null)}>
                          Back
                        </button>
                      </div>
                    </div>
                  ) : open?.id === a.appointmentId && open.kind === "cancel" ? (
                    <div className="panel-form stack-4">
                      {a.hub ? (
                        <>
                          <p>They paid {euro(paid)} through the Hub. Which is it?</p>
                          <div className="row-actions">
                            <button
                              className="btn btn-secondary"
                              disabled={busy}
                              onClick={() => act(a.appointmentId, "/api/admin/action", { appointmentId: a.appointmentId, action: "cancel_refund" }, refreshPatient)}
                            >
                              Cancel &amp; refund {euro(a.hub.netPaidMinor)}
                            </button>
                            <button
                              className="btn btn-secondary"
                              disabled={busy}
                              onClick={() => act(a.appointmentId, "/api/admin/action", { appointmentId: a.appointmentId, action: "cancel_keep" }, refreshPatient)}
                            >
                              Cancel, keep the payment
                            </button>
                            {chosen.hasSavedCard && a.hub.owedMinor > 0 && (
                              <button
                                className="btn btn-destructive"
                                disabled={busy}
                                onClick={() => act(a.appointmentId, "/api/admin/action", { appointmentId: a.appointmentId, action: "cancel_late_fee" }, refreshPatient)}
                              >
                                Late cancel: charge {euro(a.hub.owedMinor)}
                              </button>
                            )}
                            <button className="btn btn-secondary" disabled={busy} onClick={() => setOpen(null)}>
                              Back
                            </button>
                          </div>
                          <p className="secondary">Within 24 hours of the appointment the clinic&apos;s policy is the full fee: keep the payment unless the clinic says otherwise.</p>
                        </>
                      ) : (
                        <>
                          <p>Cancel this appointment? Nothing was paid through the Hub, so there&apos;s nothing to refund.</p>
                          <div className="row-actions">
                            <button
                              className="btn btn-destructive"
                              disabled={busy}
                              onClick={() => act(a.appointmentId, "/api/admin/appointments", { action: "cancel", appointmentId: a.appointmentId }, refreshPatient)}
                            >
                              Yes, cancel it
                            </button>
                            <button className="btn btn-secondary" disabled={busy} onClick={() => setOpen(null)}>
                              Back
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="row-actions">
                      <button className="btn btn-primary" disabled={busy} onClick={() => { setTime(null); setOpen({ id: a.appointmentId, kind: "move" }); }}>
                        Move
                      </button>
                      <button className="btn btn-secondary" disabled={busy} onClick={() => setOpen({ id: a.appointmentId, kind: "cancel" })}>
                        Cancel
                      </button>
                    </div>
                  )}
                </section>
              );
            })}
            <p className="secondary">Times shown are Irish time. Last checked {formatDublin(new Date().toISOString())}.</p>
          </section>
        )}
      </div>
    </DashboardShell>
  );
}
