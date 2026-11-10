"use client";

import { useEffect, useState } from "react";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { CLINIC_PHONE, CLINIC_TEL, euro } from "@/core/policy";
import { dayLong, timeShort } from "@/core/format";

/**
 * Paying for an appointment that's already happened (lib/visit-payments.ts).
 * The therapist or reception sent this link, or opened the payment for the
 * patient on their own screen; Stripe sends them back here once paid.
 */
type Visit = {
  status: "pending" | "paid" | "cancelled" | "expired";
  firstName: string;
  appointmentTypeName: string;
  practitionerName: string;
  startsAtISO: string;
  amountMinor: number;
  expiresAt: string;
};

export default function PayVisitPage({ params }: { params: { token: string } }) {
  const [visit, setVisit] = useState<Visit | null>(null);
  const [loadError, setLoadError] = useState<"not_found" | "error" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [back, setBack] = useState<"paid" | "cancelled" | null>(null);

  useEffect(() => {
    document.title = "Pay for your appointment · Northbank";
    const q = new URLSearchParams(window.location.search);
    setBack(q.get("paid") === "1" ? "paid" : q.get("cancelled") === "1" ? "cancelled" : null);
    fetch(`/api/visit-pay/${encodeURIComponent(params.token)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.status === 404) setLoadError("not_found");
        else if (!r.ok) setLoadError("error");
        else setVisit(d);
      })
      .catch(() => setLoadError("error"));
  }, [params.token]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/visit-pay/${encodeURIComponent(params.token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await res.json().catch(() => ({}));
      if (d.url) {
        window.location.href = d.url;
        return;
      }
      setError(d.error ?? `We couldn't open the payment page. Nothing has been charged. Please call us on ${CLINIC_PHONE}.`);
      if (d.code === "paid" || d.code === "expired" || d.code === "cancelled") setVisit((v) => (v ? { ...v, status: d.code } : v));
    } catch {
      setError("We couldn't open the payment page. Please check your connection and try again.");
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

  if (back === "paid") {
    return shell(
      <div className="stack-5">
        <h1>Thank you</h1>
        <Notice tone="success" title="Payment received">
          <p>{visit ? `Your ${euro(visit.amountMinor)} payment for your ${visit.appointmentTypeName.toLowerCase()} with ${visit.practitionerName} has gone through.` : "Your payment has gone through."} There&apos;s nothing more to do.</p>
        </Notice>
      </div>
    );
  }
  if (loadError) {
    return shell(
      <Notice tone="error" title={loadError === "not_found" ? "This payment link isn't valid" : "We couldn't load this payment link"} actions={call}>
        <p>Please call us and we&apos;ll sort it out.</p>
      </Notice>
    );
  }
  if (!visit) return shell(<p className="secondary">Loading…</p>);

  if (visit.status !== "pending") {
    const msg =
      visit.status === "paid"
        ? { tone: "success" as const, title: "Already paid", text: "This appointment is paid for. Thank you, there's nothing more to do." }
        : visit.status === "expired"
          ? { tone: "warning" as const, title: "This link has expired", text: "Please call us and we'll send you a new one." }
          : { tone: "warning" as const, title: "This link is no longer active", text: "You may have been sent a newer link. If not, please call us." };
    return shell(
      <div className="stack-5">
        <h1>Pay for your appointment</h1>
        <Notice tone={msg.tone} title={msg.title} actions={visit.status === "paid" ? undefined : call}>
          <p>{msg.text}</p>
        </Notice>
      </div>
    );
  }

  return shell(
    <div className="stack-5">
      <div className="page-intro">
        <h1>Pay for your appointment</h1>
        <p className="lede">Hi {visit.firstName || "there"}, thanks for coming in. Here&apos;s the payment for your appointment.</p>
      </div>

      {back === "cancelled" && (
        <Notice title="You didn't finish paying, so nothing has been charged">
          <p>Pay when you&apos;re ready.</p>
        </Notice>
      )}

      <div className="checkout-summary">
        <dl className="summary-list is-wide">
          <div className="summary-row">
            <dt>What</dt>
            <dd>{visit.appointmentTypeName}</dd>
          </div>
          <div className="summary-row">
            <dt>When</dt>
            <dd className="tnum">
              {dayLong(visit.startsAtISO)}, {timeShort(visit.startsAtISO)}
            </dd>
          </div>
          <div className="summary-row">
            <dt>Who</dt>
            <dd>{visit.practitionerName}</dd>
          </div>
        </dl>
        <div className="amount-due">
          <span className="amount-due-label">To pay</span>
          <span className="amount">{euro(visit.amountMinor)}</span>
        </div>
      </div>

      {error && (
        <Notice tone="error" title="Payment didn't start" actions={call}>
          <p>{error}</p>
        </Notice>
      )}

      <div className="stack-3">
        <button className="btn btn-primary btn-block" onClick={pay} disabled={busy}>
          {busy ? "Opening secure payment…" : `Pay ${euro(visit.amountMinor)}`}
        </button>
        <p className="handoff">Next, you&apos;ll pay on Stripe, our secure payment provider. You&apos;ll come straight back here.</p>
      </div>
    </div>
  );
}
