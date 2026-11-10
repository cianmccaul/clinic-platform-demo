"use client";

import { useEffect, useState } from "react";
import { euro, formatDublin } from "@/core/policy";
import { parseEuroToMinor } from "@/core/refunds";
import AdminControls from "@/components/AdminControls";
import PayLinks from "@/components/PayLinks";
import { Notice, SiteHeader } from "@/components/Brand";
import { BackToDashboard } from "@/components/dashboard/BackToDashboard";

/**
 * Reception: see who has paid what for online bookings, and charge
 * no-shows / balances, refund or cancel.
 *
 * On the dashboard (`mode="session"`) the signed-in person's login is used
 * and every action is recorded under their name. The old /admin page
 * (`mode="key"`) asks for the shared ADMIN_API_KEY and only works while
 * ADMIN_KEY_LOGIN is "true" (the launch-week fallback).
 */

type Row = {
  appointmentId: string;
  patientName: string;
  patientEmail: string;
  appointmentTypeName: string;
  practitionerName: string;
  startsAtISO: string;
  status: "booked" | "cancelled";
  cancelledBy: "patient" | "clinic" | null;
  lateCancellation: boolean;
  didNotArrive: boolean;
  paidMinor: number;
  refundedMinor: number;
  netPaidMinor: number;
  fullPriceMinor: number | null;
  owedMinor: number;
  hasSavedCard: boolean;
  voucher?: { code: string; amountMinor: number; returnedMinor: number; marked: boolean } | null;
  payments: { kind: string; amountMinor: number; refundedMinor: number; destination: string; ref: string; at: string }[];
};

const KEY_STORE = "demo-admin-key";
const todayDublin = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// Why a payment is given back. Reception picks one; it goes in the Cliniko
// note and the audit log, so no health details.
const REFUND_REASONS = [
  "Waive late-cancellation fee",
  "Waive no-show fee",
  "Appointment cancelled by the clinic",
  "Treatment not given / shorter session",
  "Charged by mistake",
  "Goodwill",
  "Other",
];

function RefundForm({
  row,
  busy,
  onCancel,
  onSubmit,
}: {
  row: Row;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (amountMinor: number, reason: string) => void;
}) {
  const [amount, setAmount] = useState((row.netPaidMinor / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const id = `refund-${row.appointmentId}`;
  return (
    <form
      className="panel-form stack-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const minor = parseEuroToMinor(amount);
        if (minor == null) return setProblem("Enter an amount in euro, like 45 or 45.50.");
        if (minor > row.netPaidMinor) return setProblem(`The most you can refund is ${euro(row.netPaidMinor)}.`);
        if (!reason) return setProblem("Choose a reason.");
        if (reason === "Other" && !detail.trim()) return setProblem("Say briefly why, in the box under the reason.");
        const full = [reason, detail.trim()].filter(Boolean).join(": ");
        if (!window.confirm(`Refund ${euro(minor)} to ${row.patientName || row.patientEmail}?\nReason: ${full}\n\nThe patient is emailed. This can't be undone.`)) return;
        onSubmit(minor, full);
      }}
    >
      <p className="panel-meta">
        Gives money back to the card the patient paid with, from the account it was paid to{row.payments.some((p) => p.destination === "therapist") ? " (the therapist's own Stripe account)" : ""}. Use it to waive a late-cancellation or no-show fee too. The appointment itself isn&apos;t changed.
      </p>
      <div className="field">
        <label htmlFor={`${id}-amount`}>Amount to refund (up to {euro(row.netPaidMinor)})</label>
        <input id={`${id}-amount`} className="input-short" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-reason`}>Reason</label>
        <select id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose a reason</option>
          {REFUND_REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-detail`}>Details {reason === "Other" ? "" : "(optional)"}</label>
        <p className="field-hint">Goes in the Cliniko note and the activity log. No health details.</p>
        <input id={`${id}-detail`} maxLength={120} value={detail} onChange={(e) => setDetail(e.target.value)} />
      </div>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      <div className="row-actions">
        <button className="btn btn-destructive" type="submit" disabled={busy}>
          {busy ? "Refunding…" : "Refund"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={busy}>
          Don&apos;t refund
        </button>
      </div>
    </form>
  );
}

// Extras the patient may agree to on the day (clinic, 8 Oct 2026).
const EXTRA_TREATMENTS = ["Shockwave", "Laser", "Other"];

function ExtraForm({
  row,
  busy,
  onCancel,
  onSubmit,
  failures,
}: {
  row: Row;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (amountMinor: number, reason: string, nonce: string) => void;
  failures: number;
}) {
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [detail, setDetail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // New for each try, so a retry after a decline isn't answered with Stripe's cached decline.
  const [nonce, setNonce] = useState(() => Math.random().toString(36).slice(2, 12) + Date.now().toString(36));
  useEffect(() => {
    if (failures > 0) setNonce(Math.random().toString(36).slice(2, 12) + Date.now().toString(36));
  }, [failures]);
  const id = `extra-${row.appointmentId}`;
  return (
    <form
      className="panel-form stack-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const minor = parseEuroToMinor(amount);
        if (!what) return setProblem("Choose what the extra is.");
        if (what === "Other" && !detail.trim()) return setProblem("Say what the extra treatment was.");
        if (minor == null) return setProblem("Enter the amount in euro, like 30 or 30.00.");
        if (!agreed) return setProblem("Tick the box to confirm the patient agreed to it.");
        const reason = what === "Other" ? detail.trim() : [what, detail.trim()].filter(Boolean).join(": ");
        if (!window.confirm(`Charge ${euro(minor)} for ${reason} to ${row.patientName || row.patientEmail}'s saved card?\nThey'll be emailed.`)) return;
        onSubmit(minor, reason, nonce);
      }}
    >
      <p className="panel-meta">
        For an extra treatment the patient agreed to on the day. It&apos;s charged to the card they paid with, on the same account as the booking
        {row.payments.some((p) => p.destination === "therapist") ? " (the therapist's own Stripe account)" : ""}.
      </p>
      <div className="field">
        <label htmlFor={`${id}-what`}>What for</label>
        <select id={`${id}-what`} value={what} onChange={(e) => setWhat(e.target.value)}>
          <option value="">Choose</option>
          {EXTRA_TREATMENTS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-detail`}>Details {what === "Other" ? "" : "(optional)"}</label>
        <p className="field-hint">Shown to the patient in their email and in the Cliniko note (Stripe only sees &ldquo;Extra treatment&rdquo;). No health details.</p>
        <input id={`${id}-detail`} maxLength={80} value={detail} onChange={(e) => setDetail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-amount`}>Amount (€)</label>
        <input id={`${id}-amount`} className="input-short" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>The patient agreed to this extra and its price.</span>
      </label>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      <div className="row-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Charging…" : "Charge the extra"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={busy}>
          Don&apos;t charge
        </button>
      </div>
    </form>
  );
}

const KIND_LABEL: Record<string, string> = {
  deposit: "Deposit (before 8 Oct)",
  full: "Paid in full",
  balance: "Balance",
  no_show: "No-show fee",
  late_cancel: "Late cancellation fee",
  extra: "Extra",
};

export default function BookingsAdmin({ mode }: { mode: "session" | "key" }) {
  const session = mode === "session";
  const [key, setKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [date, setDate] = useState(todayDublin());
  const [email, setEmail] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [byEmail, setByEmail] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [extraFor, setExtraFor] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);

  const authHeader: Record<string, string> = session ? {} : { Authorization: `Bearer ${key}` };

  useEffect(() => {
    if (session) return;
    try {
      const saved = sessionStorage.getItem(KEY_STORE);
      if (saved) setKey(saved);
    } catch {}
  }, []);

  async function load(opts?: { byEmail?: boolean }) {
    setError(null);
    setBusy("load");
    const useEmail = opts?.byEmail ?? false;
    setByEmail(useEmail);
    const q = useEmail ? `email=${encodeURIComponent(email)}` : `date=${date}`;
    try {
      const res = await fetch(`/api/admin/bookings?${q}`, { headers: authHeader });
      const data = await res.json();
      if (res.status === 401 && session) {
        setError("Your sign-in has ended. Open the dashboard and sign in again.");
        return;
      }
      if (res.status === 403 && session) return setError(data.error ?? "Your role doesn't include this.");
      if (res.status === 401) {
        setKey("");
        try { sessionStorage.removeItem(KEY_STORE); } catch {}
        setError("That admin key wasn't accepted.");
        return;
      }
      if (!res.ok) return setError(data.error ?? "Couldn't load bookings.");
      setRows(data.bookings);
    } catch {
      setError("Couldn't load bookings.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (session || key) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, date]);

  async function act(row: Row, action: string, question: string | null, extra: Record<string, unknown> = {}) {
    if (question && !window.confirm(question)) return;
    setBusy(row.appointmentId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ appointmentId: row.appointmentId, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(`${row.patientName}: ${data.error ?? "failed"}`);
        // Only a definite decline gets a fresh charge key. Anything else (a
        // timeout, a server error) may have charged, so a retry must reuse
        // the same key and Stripe will return the first charge, not a second.
        if (data.code === "declined") setFailures((n) => n + 1);
      }
      else {
        setNotice(`${row.patientName}: ${data.message}`);
        setRefunding(null);
        setExtraFor(null);
      }
      await load({ byEmail });
    } finally {
      setBusy(null);
    }
  }

  if (!session && !key) {
    return (
      <>
      <SiteHeader variant="staff" />
      <main id="main" className="page page-narrow">
        <div className="page-intro">
          <h1>Online bookings</h1>
          <p className="lede">Staff only. Enter the admin key to continue.</p>
        </div>
        {error && (
          <div className="block-gap">
            <Notice tone="error">
              <p>{error}</p>
            </Notice>
          </div>
        )}
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!keyInput) return;
            try { sessionStorage.setItem(KEY_STORE, keyInput); } catch {}
            setKey(keyInput);
          }}
        >
          <div className="field">
            <label htmlFor="admin-key">Admin key</label>
            <input id="admin-key" type="password" autoComplete="current-password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={!keyInput}>
            Continue
          </button>
        </form>
      </main>
      </>
    );
  }

  const started = (r: Row) => new Date(r.startsAtISO).getTime() <= Date.now();

  return (
    <>
    {!session && <SiteHeader variant="staff" />}
    <main id="main" className="page">
      {session && <BackToDashboard />}
      <div className="page-intro">
        <h1>Online bookings</h1>
        <p className="lede">Payments, cancellations and no-shows for bookings made online. Every action is logged.</p>
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="admin-date">Day</label>
          <input id="admin-date" type="date" value={date} onChange={(e) => { setEmail(""); setDate(e.target.value); }} />
        </div>
        <div className="field">
          <label htmlFor="admin-email">Or patient email</label>
          <input id="admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button className="btn btn-secondary" disabled={!email.includes("@") || busy === "load"} onClick={() => load({ byEmail: true })}>
          Search
        </button>
      </div>

      {/* Only once the key has been accepted, so a typo isn't counted twice. */}
      {rows !== null && <PayLinks adminKey={session ? "" : key} />}
      {rows !== null && <AdminControls adminKey={session ? "" : key} />}

      {error && (
        <div className="block-gap">
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        </div>
      )}
      {notice && (
        <div className="block-gap">
          <Notice tone="success">
            <p>{notice}</p>
          </Notice>
        </div>
      )}
      {busy === "load" && <p className="secondary block-gap">Loading bookings…</p>}
      {rows && rows.length === 0 && busy !== "load" && <p className="secondary block-gap">No online bookings found.</p>}

      {rows?.map((r) => (
        <section key={r.appointmentId} className="panel">
          <h2 className="panel-title">
            <span className="tnum">
              {new Date(r.startsAtISO).toLocaleTimeString("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit" })}
            </span>{" "}
            · {r.patientName || r.patientEmail}
          </h2>
          <p className="panel-meta">
            {r.appointmentTypeName} with {r.practitionerName} — {formatDublin(r.startsAtISO)}
          </p>
          <p className="panel-meta">{r.patientEmail}</p>

          <div className="badge-row">
            {r.status === "cancelled" && (
              <span className="badge is-bad">
                Cancelled{r.cancelledBy ? ` by ${r.cancelledBy}` : ""}{r.lateCancellation ? " (late — fee applies)" : ""}
              </span>
            )}
            {r.didNotArrive && <span className="badge is-bad">Did not arrive</span>}
            {r.payments.map((p) => (
              <span key={p.ref} className={`badge${p.refundedMinor ? " is-warn" : ""}`} title={`Stripe ${p.ref}`}>
                {KIND_LABEL[p.kind] ?? p.kind}: {euro(p.amountMinor)}
                {p.refundedMinor ? ` (refunded ${euro(p.refundedMinor)})` : ""}
                {p.destination === "therapist" ? " → therapist" : ""}
              </span>
            ))}
            {r.voucher && (
              <span className={`badge${r.voucher.returnedMinor || !r.voucher.marked ? " is-warn" : ""}`}>
                Gift voucher {r.voucher.code}: {euro(r.voucher.amountMinor)}
                {r.voucher.returnedMinor ? ` (put back ${euro(r.voucher.returnedMinor)})` : ""}
                {!r.voucher.marked ? " (not marked used yet)" : ""}
              </span>
            )}
            {r.status === "booked" && r.fullPriceMinor != null && (
              <span className={`badge${r.owedMinor ? " is-warn" : " is-good"}`}>
                {r.owedMinor ? `Balance due ${euro(r.owedMinor)} of ${euro(r.fullPriceMinor)}` : "Fully paid"}
              </span>
            )}
            {!r.hasSavedCard && <span className="badge is-warn">No saved card</span>}
          </div>

          <div className="row-actions">
            {r.status === "booked" && started(r) && r.owedMinor > 0 && r.hasSavedCard && (
              <>
                <button
                  className="btn btn-secondary"
                  disabled={!!busy}
                  onClick={() => act(r, "charge_balance", `Charge the remaining ${euro(r.owedMinor)} to ${r.patientName}'s saved card?`)}
                >
                  Charge balance {euro(r.owedMinor)}
                </button>
                <button
                  className="btn btn-destructive"
                  disabled={!!busy}
                  onClick={() =>
                    act(r, "charge_no_show", `${r.patientName} didn't show up — charge ${euro(r.owedMinor)} (full price minus what's paid) to their saved card and email them?`)
                  }
                >
                  No-show: charge {euro(r.owedMinor)}
                </button>
              </>
            )}
            {r.status === "booked" && !started(r) && (
              <>
                <button
                  className="btn btn-secondary"
                  disabled={!!busy}
                  onClick={() =>
                    act(
                      r,
                      "cancel_refund",
                      `Cancel ${r.patientName}'s appointment and refund ${euro(r.netPaidMinor)}${r.voucher && r.voucher.amountMinor > r.voucher.returnedMinor ? `, and put ${euro(r.voucher.amountMinor - r.voucher.returnedMinor)} back on gift voucher ${r.voucher.code}` : ""}?`
                    )
                  }
                >
                  Cancel &amp; refund
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={!!busy}
                  onClick={() => act(r, "cancel_keep", `Cancel ${r.patientName}'s appointment, KEEP the ${euro(r.netPaidMinor)} paid and charge nothing more?`)}
                >
                  Cancel, keep payment
                </button>
                {r.hasSavedCard && r.owedMinor > 0 && (
                  <button
                    className="btn btn-destructive"
                    disabled={!!busy}
                    onClick={() =>
                      act(r, "cancel_late_fee", `Late cancellation: cancel ${r.patientName}'s appointment and charge the remaining ${euro(r.owedMinor)} (full fee) to their saved card?`)
                    }
                  >
                    Late cancel: charge {euro(r.owedMinor)}
                  </button>
                )}
              </>
            )}
            {r.status === "booked" && r.hasSavedCard && extraFor !== r.appointmentId && (
              <button className="btn btn-secondary" disabled={!!busy} onClick={() => { setRefunding(null); setExtraFor(r.appointmentId); }}>
                Charge an extra…
              </button>
            )}
            {r.netPaidMinor > 0 && refunding !== r.appointmentId && (
              <button className="btn btn-secondary" disabled={!!busy} onClick={() => { setExtraFor(null); setRefunding(r.appointmentId); }}>
                Refund or waive…
              </button>
            )}
          </div>
          {extraFor === r.appointmentId && (
            <ExtraForm
              row={r}
              busy={busy === r.appointmentId}
              onCancel={() => setExtraFor(null)}
              failures={failures}
              onSubmit={(amountMinor, reason, nonce) => act(r, "charge_extra", null, { amountMinor, reason, nonce })}
            />
          )}
          {refunding === r.appointmentId && (
            <RefundForm
              row={r}
              busy={busy === r.appointmentId}
              onCancel={() => setRefunding(null)}
              onSubmit={(amountMinor, reason) => act(r, "refund", null, { amountMinor, reason })}
            />
          )}
        </section>
      ))}

      {!session && (
        <button
          className="link-button block-gap"
          onClick={() => {
            try { sessionStorage.removeItem(KEY_STORE); } catch {}
            setKey("");
            setRows(null);
          }}
        >
          Sign out
        </button>
      )}
    </main>
    </>
  );
}
