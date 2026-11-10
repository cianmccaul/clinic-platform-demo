"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/Brand";

/**
 * Reception's clinic-wide controls on the admin page:
 * - Online booking switch (the kill switch — pause if Cliniko/Stripe misbehave)
 * - Owners and super admins: the emergency redirect to Cliniko's own booking page
 * - "Run checks now" (the reconciliation job, normally daily at ~07:00)
 * - Recent activity (the audit log: every charge, refund and staff action)
 */
type Flag = { enabled: boolean; source: string; changedAt?: string; reason?: string; redirect?: boolean; redirectUrl?: string };
type Issue = { severity: "urgent" | "check"; title: string; detail: string };
type Event = { ts: string; actor: string; by?: string; action: string; appointmentId?: string; amountMinor?: number; stripeId?: string; ok?: boolean; note?: string };

const euro = (m?: number) => (m == null ? "" : `€${(m / 100).toFixed(2)}`);
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function AdminControls({ adminKey }: { adminKey: string }) {
  // No key = signed in to the dashboard: the session cookie is sent instead.
  const auth: Record<string, string> = adminKey ? { Authorization: `Bearer ${adminKey}` } : {};
  const [flag, setFlag] = useState<Flag | null>(null);
  const [canRedirect, setCanRedirect] = useState(false);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadFlag() {
    const res = await fetch("/api/admin/flags", { headers: auth });
    if (res.ok) {
      const data = await res.json();
      setFlag(data.onlineBooking);
      setCanRedirect(!!data.canRedirect);
    }
  }
  useEffect(() => {
    loadFlag().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);

  async function setSwitch(body: { enabled: boolean; reason?: string; redirect?: boolean }) {
    setBusy("flag");
    setError(null);
    try {
      const res = await fetch("/api/admin/flags", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Couldn't change the switch.");
      else {
        setFlag(data.onlineBooking);
        setCanRedirect(!!data.canRedirect);
        if (data.note) setError(data.note);
      }
    } catch {
      setError("Couldn't reach the server. If the dashboard is broken, use the Vercel switch in the guide 'If the dashboard or online booking breaks'.");
    } finally {
      setBusy(null);
    }
  }

  async function toggle() {
    if (!flag) return;
    const turningOff = flag.enabled;
    const reason = turningOff ? window.prompt("Pause online booking — reason (optional, e.g. 'Cliniko down'):") : "";
    if (reason === null) return;
    if (!turningOff && !window.confirm(flag.redirect ? "Stop sending patients to Cliniko, and turn online booking and payments back ON here?" : "Turn online booking and payments back ON?")) return;
    await setSwitch({ enabled: !turningOff, reason: reason || undefined });
  }

  async function emergencyRedirect() {
    if (!flag) return;
    const ok = window.confirm(
      "EMERGENCY: send every patient from book.northbank.example to Cliniko's own booking page?\n\n" +
        "• No payments are taken online. Bookings made there are paid at the clinic.\n" +
        "• Manage a booking and the dashboard keep working.\n" +
        "• Reception gets an alert email.\n\n" +
        "Use it only if the Hub has to be pulled."
    );
    if (!ok) return;
    const reason = window.prompt("Reason (e.g. 'Payments failing'):");
    if (reason === null) return;
    await setSwitch({ enabled: false, redirect: true, reason: reason || undefined });
  }

  async function runChecks() {
    setBusy("checks");
    setError(null);
    try {
      const res = await fetch("/api/cron/reconcile", { method: "POST", headers: auth });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Checks failed to run.");
      else setIssues(data.issues);
    } catch {
      setError("Checks failed to run.");
    } finally {
      setBusy(null);
    }
  }

  async function loadActivity() {
    setBusy("activity");
    try {
      const res = await fetch("/api/admin/audit?limit=50", { headers: auth });
      const data = await res.json();
      if (res.ok) setEvents(data.events);
      else setError(data.error ?? "Couldn't load activity.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel block-gap">
      <h2 className="panel-title">Clinic controls</h2>

      <div className="row-actions">
        {flag ? (
          <>
            <span className={`badge${flag.enabled ? " is-good" : " is-bad"}`}>
              Online booking: {flag.enabled ? "ON" : flag.redirect ? "SENT TO CLINIKO" : "PAUSED"}
              {flag.source === "env" ? " (set in Vercel settings)" : ""}
              {flag.changedAt ? ` · changed ${when(flag.changedAt)}` : ""}
              {!flag.enabled && flag.reason ? ` · ${flag.reason}` : ""}
            </span>
            {flag.source !== "env" && (!flag.redirect || canRedirect) && (
              <button className={flag.enabled ? "btn btn-destructive" : "btn btn-secondary"} disabled={!!busy} onClick={toggle}>
                {flag.enabled ? "Pause online booking" : "Turn online booking back on"}
              </button>
            )}
            {flag.source !== "env" && canRedirect && !flag.redirect && (
              <button className="btn btn-destructive" disabled={!!busy} onClick={emergencyRedirect}>
                Emergency: send patients to Cliniko
              </button>
            )}
          </>
        ) : (
          <span className="secondary">Loading switch…</span>
        )}
      </div>

      <div className="row-actions">
        <button className="btn btn-secondary" disabled={!!busy} onClick={runChecks}>
          {busy === "checks" ? "Checking…" : "Run checks now"}
        </button>
        <button className="btn btn-secondary" disabled={!!busy} onClick={loadActivity}>
          {busy === "activity" ? "Loading…" : "Recent activity"}
        </button>
      </div>

      {flag?.redirect && (
        <div className="row-actions">
          <Notice tone="warning" title="Patients are being sent to Cliniko's booking page">
            <p>
              book.northbank.example goes to <a href={flag.redirectUrl}>{flag.redirectUrl}</a>. Bookings made there aren&apos;t paid: take payment at the
              clinic and record it in Cliniko. Online bookings must stay switched on in Cliniko.
              {!canRedirect ? " Only an owner or super admin can turn this off." : ""}
            </p>
          </Notice>
        </div>
      )}

      {error && (
        <div className="row-actions">
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        </div>
      )}

      {issues && (
        <div className="log">
          {issues.length === 0 ? (
            <Notice tone="success">
              <p>All clear. Stripe, Cliniko and the booking records agree.</p>
            </Notice>
          ) : (
            issues.map((i, n) => (
              <p key={n} className="panel-meta">
                <span className={`badge ${i.severity === "urgent" ? "is-bad" : "is-warn"}`}>{i.severity === "urgent" ? "Urgent" : "Check"}</span>{" "}
                <strong>{i.title}</strong> — {i.detail}
              </p>
            ))
          )}
        </div>
      )}

      {events && (
        <div className="log">
          {events.length === 0 && <p className="secondary">No activity yet.</p>}
          {events.map((e, n) => (
            <p key={n} className="panel-meta">
              {when(e.ts)} · {e.by ?? e.actor} · {e.action}
              {e.amountMinor != null ? ` · ${euro(e.amountMinor)}` : ""}
              {e.appointmentId ? ` · appt ${e.appointmentId}` : ""}
              {e.ok === false ? " · FAILED" : ""}
              {e.note ? ` · ${e.note}` : ""}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
