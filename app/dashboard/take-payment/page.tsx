"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { euro } from "@/core/policy";
import { whenShort } from "@/core/format";
import { parseEuroInput, visitAmountRefusal, VISIT_LINK_DAYS, VISIT_LOOKBACK_DAYS } from "@/core/visit-payment";

/**
 * Take a payment for an appointment that's already happened (6 Nov 2026,
 * lib/visit-payments.ts). Therapists see their own appointments; reception
 * and owners choose the therapist first. Money goes to the therapist's own
 * Stripe account, or Northbank's for Clare.
 */
export default function TakePaymentPage() {
  return (
    <StaffGate permission="phone-booking:own" title="Payment for a past appointment">
      {() => <TakePayment />}
    </StaffGate>
  );
}

type Appt = {
  appointmentId: string;
  startsAtISO: string;
  patientName: string;
  appointmentTypeName: string;
  priceMinor: number | null;
  paidMinor: number;
  suggestedMinor: number | null;
  didNotArrive: boolean;
  pending: { amountMinor: number; email: string; createdAt: string } | null;
};
type List = {
  anyone: boolean;
  practitioners: { id: string; name: string }[];
  practitionerId: string | null;
  practitionerName?: string;
  paysTo?: "clinic" | "therapist" | "not_set_up";
  appointments: Appt[];
};
type Result = { method: "page" | "email"; link: string; sent?: boolean; sendError?: string; openedHere?: boolean; url?: string; email: string; amountMinor: number };

function TakePayment() {
  const [list, setList] = useState<List | null>(null);
  const [practitionerId, setPractitionerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [picked, setPicked] = useState<Appt | null>(null);
  const [email, setEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"page" | "email">("page");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (pid: string) => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/staff/visit-payments${pid ? `?practitionerId=${encodeURIComponent(pid)}` : ""}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't load the appointments.");
      setList(json);
      if (json.practitionerId) setPractitionerId(json.practitionerId);
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  async function pick(a: Appt) {
    setPicked(a);
    setResult(null);
    setError("");
    setMethod("page");
    setAmount(a.suggestedMinor != null && a.suggestedMinor > 0 ? (a.suggestedMinor / 100).toFixed(2) : "");
    setEmail(a.pending?.email ?? "");
    setTimeout(() => formRef.current?.focus(), 50);
    if (a.pending?.email) return;
    setEmailLoading(true);
    try {
      const res = await fetch(`/api/staff/visit-payments?appointmentId=${a.appointmentId}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.email) setEmail(json.email);
    } finally {
      setEmailLoading(false);
    }
  }

  const amountMinor = parseEuroInput(amount);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const amountProblem = amountMinor == null ? "Enter the amount, like 65 or 65.50." : visitAmountRefusal(amountMinor);

  async function submit() {
    if (!picked || amountMinor == null || amountProblem || !emailOk) {
      setError(!emailOk ? "Check the patient's email." : amountProblem ?? "Check the details.");
      return;
    }
    const payHere = method === "page";
    // Open the tab now, while the click still counts, or the browser blocks it as a pop-up.
    let win: Window | null = null;
    if (payHere) {
      win = window.open("", "_blank");
      try {
        if (win) {
          win.opener = null;
          win.document.title = "Opening the payment page…";
          win.document.body.textContent = "Opening the payment page…";
        }
      } catch {
        /* the tab still opens below */
      }
    }
    setBusy(true);
    setError("");
    let opened = false;
    try {
      const res = await fetch("/api/staff/visit-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: picked.appointmentId, email: email.trim(), amountMinor, method }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Nothing was sent or charged.");
        return;
      }
      if (win && typeof data.url === "string") {
        win.location.href = data.url;
        opened = true;
      }
      setResult({ method, link: data.link, sent: data.sent, sendError: data.sendError, openedHere: opened, url: data.url, email: email.trim(), amountMinor });
      setTimeout(() => resultRef.current?.focus(), 50);
    } catch {
      setError("Couldn't reach the Hub. Nothing was sent. Check the connection and try again.");
    } finally {
      if (win && !opened) win.close();
      setBusy(false);
    }
  }

  function again() {
    setPicked(null);
    setResult(null);
    setCopied(false);
    load(practitionerId);
  }

  const paysToText =
    list?.paysTo === "therapist"
      ? `The money goes to ${list.anyone ? `${list.practitionerName}'s` : "your"} own Stripe account.`
      : list?.paysTo === "clinic"
        ? "The money goes to Northbank's own Stripe account."
        : list?.paysTo === "not_set_up"
          ? "This therapist's Stripe account isn't set up yet, so payments can't be taken online."
          : null;

  return (
    <DashboardShell
      title="Payment for a past appointment"
      lede={`Pick an appointment from the last ${VISIT_LOOKBACK_DAYS} days, check the email and the amount, then let the patient pay on this screen or email them a link.`}
      narrow
    >
      <div className="stack-5">
        {loadError && (
          <Notice tone="error" actions={<button className="btn btn-secondary" onClick={() => load(practitionerId)}>Try again</button>}>
            <p>{loadError}</p>
          </Notice>
        )}

        {list?.anyone && (
          <div className="field">
            <label htmlFor="vp-prac">Therapist</label>
            <select
              id="vp-prac"
              value={practitionerId}
              onChange={(e) => {
                setPractitionerId(e.target.value);
                setPicked(null);
                setResult(null);
                if (e.target.value) load(e.target.value);
              }}
            >
              <option value="">Choose a therapist</option>
              {list.practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {paysToText && list?.practitionerId && <Notice tone={list.paysTo === "not_set_up" ? "warning" : "info"}><p>{paysToText}</p></Notice>}

        {loading && <p className="secondary" role="status">Loading appointments from Cliniko…</p>}

        {!loading && list?.practitionerId && !picked && (
          list.appointments.length === 0 ? (
            <p className="secondary">No appointments in the last {VISIT_LOOKBACK_DAYS} days.</p>
          ) : (
            <section className="stack-3" aria-labelledby="vp-list">
              <h2 className="panel-title" id="vp-list">Which appointment?</h2>
              <ul className="option-list">
                {list.appointments.map((a) => {
                  const fullyPaid = a.priceMinor != null && a.paidMinor >= a.priceMinor && a.paidMinor > 0;
                  return (
                    <li key={a.appointmentId}>
                      <button type="button" className="option" onClick={() => pick(a)}>
                        <span className="option-main">
                          <span className="option-title">
                            {a.patientName}{" "}
                            {fullyPaid && <span className="badge">Paid {euro(a.paidMinor)}</span>}
                            {!fullyPaid && a.paidMinor > 0 && <span className="badge">{euro(a.paidMinor)} paid so far</span>}
                            {a.pending && <span className="badge is-warn">Link sent: {euro(a.pending.amountMinor)}</span>}
                            {a.didNotArrive && <span className="badge is-warn">Did not arrive</span>}
                          </span>
                          <span className="option-desc tnum">
                            {whenShort(a.startsAtISO)} · {a.appointmentTypeName}
                            {a.priceMinor != null ? ` · ${euro(a.priceMinor)}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )
        )}

        {picked && !result && (
          <section className="panel stack-5" aria-labelledby="vp-form">
            <h2 className="panel-title" id="vp-form" ref={formRef} tabIndex={-1}>
              {picked.patientName}: {picked.appointmentTypeName}, {whenShort(picked.startsAtISO)}
            </h2>
            {picked.paidMinor > 0 && (
              <Notice tone="info">
                <p>
                  {euro(picked.paidMinor)} is already paid through the Hub{picked.priceMinor != null ? ` (full price ${euro(picked.priceMinor)})` : ""}. Only ask for what's still owed or an agreed extra.
                </p>
              </Notice>
            )}
            {picked.pending && (
              <Notice tone="warning">
                <p>A link for {euro(picked.pending.amountMinor)} was already sent to {picked.pending.email}. Sending a new one switches the old one off.</p>
              </Notice>
            )}
            <form className="stack-5" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <div className="field">
                <label htmlFor="vp-email">Patient&apos;s email</label>
                <p className="field-hint">{emailLoading ? "Getting their email from Cliniko…" : "From their Cliniko record. Check it with them: the receipt goes here."}</p>
                <input id="vp-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="vp-amount">Amount to pay (€)</label>
                <p className="field-hint">{picked.suggestedMinor != null ? `Filled in with the price less anything already paid. Change it if you agreed something else.` : "Cliniko has no price for this treatment: type the amount."}</p>
                <input id="vp-amount" className="input-short" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <fieldset className="field">
                <legend className="label">How will they pay?</legend>
                <label className="checkbox">
                  <input type="radio" name="vp-method" checked={method === "page"} onChange={() => setMethod("page")} />
                  <span>Now, on this screen (the payment page opens in a new tab for them to tap their card or phone)</span>
                </label>
                <label className="checkbox">
                  <input type="radio" name="vp-method" checked={method === "email"} onChange={() => setMethod("email")} />
                  <span>Email them a link to pay later (works for {VISIT_LINK_DAYS} days)</span>
                </label>
              </fieldset>
              {error && (
                <Notice tone="error">
                  <p>{error}</p>
                </Notice>
              )}
              <div className="actions">
                <button className="btn btn-primary" type="submit" disabled={busy || list?.paysTo === "not_set_up"}>
                  {busy ? "Working…" : method === "page" ? `Open the payment page${amountMinor ? ` for ${euro(amountMinor)}` : ""}` : `Email the link${amountMinor ? ` for ${euro(amountMinor)}` : ""}`}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => setPicked(null)}>
                  Pick another appointment
                </button>
              </div>
            </form>
          </section>
        )}

        {result && (
          <div ref={resultRef} tabIndex={-1} className="stack-5">
            {result.method === "page" ? (
              <Notice tone="info" title={result.openedHere ? "The payment page is open in a new tab" : "Open the payment page"}>
                <p>Hand the screen to the patient to pay {euro(result.amountMinor)}. Once they've paid, it's added to the appointment and noted in Cliniko by itself.</p>
                {!result.openedHere && result.url && (
                  <p>
                    <a className="btn btn-primary" href={result.url} target="_blank" rel="noopener noreferrer">
                      Open the payment page
                    </a>
                  </p>
                )}
              </Notice>
            ) : result.sent ? (
              <Notice tone="success" title={`Sent by email to ${result.email}`}>
                <p>When they pay, it's added to the appointment and noted in Cliniko by itself.</p>
              </Notice>
            ) : (
              <Notice tone="warning" title="The email didn't go">
                <p>{result.sendError}</p>
              </Notice>
            )}
            <div className="field">
              <label htmlFor="vp-link">The link (only for this patient)</label>
              <div className="inline-form">
                <input id="vp-link" readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} />
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(result.link);
                      setCopied(true);
                    } catch {
                      /* the box is selectable */
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-primary" type="button" onClick={again}>
                Take another payment
              </button>
              <a className="btn btn-secondary" href="/dashboard">
                Back to the dashboard
              </a>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
