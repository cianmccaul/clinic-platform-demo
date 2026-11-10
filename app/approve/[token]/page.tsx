"use client";

import { useEffect, useState } from "react";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { CLINIC_MAP_URL, CLINIC_PHONE, CLINIC_TEL, EXTRAS_SENTENCE, euro } from "@/core/policy";
import { CLINIC_ADDRESS, checkoutLineItem, timeShort, whenLong } from "@/core/format";

/**
 * The link a patient is emailed when their bank wants them to approve a
 * payment reception took with their saved card (lib/approvals.ts). "Approve
 * with your bank" sends them to their bank's approval on Stripe's own page
 * and back here; the appointment is booked as soon as it's approved. No
 * card details are typed here, and no third-party script runs.
 */
type View = {
  status: "waiting" | "failed" | "paid" | "expired" | "cancelled" | "booking_failed";
  firstName: string;
  appointmentTypeName: string;
  practitionerName: string;
  startsAtISO: string;
  durationMinutes: number;
  amountMinor: number;
  expiresAt: string;
  last4: string | null;
};

export default function ApprovePage({ params }: { params: { token: string } }) {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = `/api/approve/${encodeURIComponent(params.token)}`;

  useEffect(() => {
    // Back from the bank: ask whether it went through (and book it) before showing anything.
    const back = new URLSearchParams(window.location.search).has("back");
    setChecking(back);
    const load = back ? fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }) }) : fetch(api, { cache: "no-store" });
    load
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.status === 404) setLoadError("not_found");
        else if (!r.ok) setLoadError("error");
        else setView(d);
      })
      .catch(() => setLoadError("error"))
      .finally(() => setChecking(false));
    if (back) window.history.replaceState(null, "", window.location.pathname);
  }, [api]);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) });
      const d = await res.json().catch(() => ({}));
      if (d.redirect) {
        window.location.href = d.redirect;
        return;
      }
      if (res.ok && d.status) setView(d);
      else setError(d.error ?? `We couldn't reach your bank just now. Nothing has been charged. Please try again, or call us on ${CLINIC_PHONE}.`);
    } catch {
      setError("We couldn't reach your bank. Please check your connection and try again.");
    }
    setBusy(false);
  }

  const call = (
    <a className="btn btn-secondary" href={CLINIC_TEL}>
      <Icon name="phone" /> Call {CLINIC_PHONE}
    </a>
  );
  const shell = (body: React.ReactNode) => (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        {body}
      </main>
    </>
  );

  if (loadError) {
    return shell(
      <Notice tone="error" title={loadError === "not_found" ? "This link isn't valid" : "We couldn't load this link"} actions={call}>
        <p>Please call us and we&apos;ll sort it out.</p>
      </Notice>
    );
  }
  if (!view) return shell(<p className="secondary">{checking ? "Checking with your bank…" : "Loading…"}</p>);

  const line = checkoutLineItem(view.appointmentTypeName, view.startsAtISO);

  if (view.status !== "waiting" && view.status !== "failed") {
    const msg =
      view.status === "paid"
        ? { tone: "success" as const, title: "Approved. You're booked", text: `Thanks, ${view.firstName}. ${euro(view.amountMinor)} has been paid and your appointment is booked. Your confirmation email is on its way.` }
        : view.status === "expired"
          ? { tone: "warning" as const, title: "This link has expired", text: "Nothing has been charged, and the time is no longer held for you. Please call us and we'll find you a time." }
          : view.status === "cancelled"
            ? { tone: "warning" as const, title: "This link is no longer needed", text: "Nothing has been charged here. The clinic has sent you another way to pay; check your email, or call us." }
            : { tone: "warning" as const, title: "We couldn't finish your booking", text: "We'll be in touch. If any money was taken it has been refunded or the clinic will contact you about it. Please call us if you have questions." };
    return shell(
      <div className="stack-5">
        <h1>{line.name}</h1>
        <Notice tone={msg.tone} title={msg.title} actions={view.status === "paid" ? <a className="btn btn-secondary" href="/manage">Manage booking</a> : call}>
          <p>{msg.text}</p>
        </Notice>
      </div>
    );
  }

  return shell(
    <div className="stack-5">
      <div className="page-intro">
        <h1>Approve your payment</h1>
        <p className="lede">
          Hi {view.firstName}, your bank needs you to approve this payment{view.last4 ? ` on the card ending ${view.last4} that you saved with us` : ""}. The
          time is held for you until {timeShort(view.expiresAt)}.
        </p>
      </div>

      {view.status === "failed" && (
        <Notice tone="warning" title="Your bank didn't approve it">
          <p>Nothing has been charged. You can try again below, or call us and we&apos;ll find another way to pay.</p>
        </Notice>
      )}

      <div className="checkout-summary">
        <dl className="summary-list is-wide">
          <div className="summary-row">
            <dt>What</dt>
            <dd>{line.name}</dd>
          </div>
          <div className="summary-row">
            <dt>When</dt>
            <dd className="tnum">
              {whenLong(view.startsAtISO)} · {view.durationMinutes} min
            </dd>
          </div>
          <div className="summary-row">
            <dt>Who</dt>
            <dd>{view.practitionerName}</dd>
          </div>
          <div className="summary-row">
            <dt>Where</dt>
            <dd>
              Northbank, {CLINIC_ADDRESS}
              <br />
              <a className="secondary" href={CLINIC_MAP_URL} target="_blank" rel="noreferrer">
                Open in maps<span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </dd>
          </div>
        </dl>
        <div className="amount-due">
          <span className="amount-due-label">To approve</span>
          <span className="amount">{euro(view.amountMinor)}</span>
        </div>
        <p className="secondary">{EXTRAS_SENTENCE}</p>
      </div>

      {error && (
        <Notice tone="error">
          <p>{error}</p>
        </Notice>
      )}

      <div className="stack-3">
        <button className="btn btn-primary btn-block" onClick={approve} disabled={busy}>
          {busy ? "Opening your bank…" : view.status === "failed" ? "Try again with your bank" : "Approve with your bank"}
        </button>
        <p className="secondary">Your bank shows you the payment and asks you to approve it, usually in its app. Then you come back here.</p>
      </div>
    </div>
  );
}
