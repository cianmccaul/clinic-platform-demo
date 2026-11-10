"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { ProblemSummary, focusSoon, type Problem } from "@/components/ProblemSummary";
import { MARKETING_OPT_IN_HINT, MARKETING_OPT_IN_LABEL } from "@/core/mailerlite";
import { CLINIC_MAP_URL, CLINIC_PHONE, CLINIC_TEL, EXTRAS_SENTENCE, POLICY_SENTENCE, PRIVACY_CONSENT_LABEL, PRIVACY_CONSENT_TEXT, PRIVACY_CONSENT_TITLE, PRIVACY_URL, euro } from "@/core/policy";
import { CLINIC_ADDRESS, checkoutLineItem, timeShort, whenLong } from "@/core/format";
import { isPlausibleDateOfBirth } from "@/core/patient-details";

/**
 * The payment link reception sends after booking a patient by phone. The
 * patient sees what was booked, agrees to the cancellation policy and the
 * privacy agreement (the same two boxes as online), and pays on Stripe. The
 * appointment is booked the moment they've paid.
 */
type Link = {
  status: "pending" | "paid" | "cancelled" | "expired" | "refunded" | "rebook";
  firstName: string;
  appointmentTypeName: string;
  practitionerName: string;
  startsAtISO: string;
  durationMinutes: number;
  amountMinor: number;
  expiresAt: string;
  /** An offer from the waitlist rather than a phone booking. */
  waitlist?: boolean;
  /** Someone new to the clinic: date of birth, address and GP are asked before paying. */
  needsDetails?: boolean;
  /** Waitlist offers: where to pause or leave the waitlist (the offer text has only this page's link). */
  leavePath?: string | null;
};

export default function PayLinkPage({ params }: { params: { token: string } }) {
  const [link, setLink] = useState<Link | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [policy, setPolicy] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [dob, setDob] = useState({ d: "", m: "", y: "" });
  const [address, setAddress] = useState("");
  const [county, setCounty] = useState("");
  const [eircode, setEircode] = useState("");
  const [gpName, setGpName] = useState("");
  const policyRef = useRef<HTMLInputElement>(null);
  const privacyRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCancelled(new URLSearchParams(window.location.search).get("cancelled") === "1");
    fetch(`/api/pay/${encodeURIComponent(params.token)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.status === 404) setLoadError("not_found");
        else if (!r.ok) setLoadError("error");
        else setLink(d);
      })
      .catch(() => setLoadError("error"));
  }, [params.token]);

  useEffect(() => {
    document.title = "Pay for your appointment · Northbank";
  }, []);

  const dobIso = `${dob.y}-${dob.m.padStart(2, "0")}-${dob.d.padStart(2, "0")}`;
  const detailsOk = !link?.needsDetails || (isPlausibleDateOfBirth(dobIso) && !!address.trim() && !!gpName.trim());

  // Everything still missing, in page order, for the "There is a problem" box (audit M4).
  const problems: Problem[] = [
    ...(link?.needsDetails && !isPlausibleDateOfBirth(dobIso) ? [{ id: "wl-dob-d", text: "Enter a real date of birth, like 2 4 1958" }] : []),
    ...(link?.needsDetails && !address.trim() ? [{ id: "wl-address", text: "Enter your address" }] : []),
    ...(link?.needsDetails && !gpName.trim() ? [{ id: "wl-gp", text: "Enter your GP's name" }] : []),
    ...(!policy ? [{ id: "pay-policy", text: "Tick the box to agree to the cancellation policy" }] : []),
    ...(!privacy ? [{ id: "pay-privacy", text: "Tick \u201cI agree\u201d to the privacy and sharing of information" }] : []),
  ];

  async function pay() {
    setShowErrors(true);
    if (!detailsOk || !policy || !privacy) {
      focusSoon(() => summaryRef.current);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(params.token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyAccepted: true,
          privacyAcknowledged: true,
          marketingOptIn: marketing,
          ...(link?.needsDetails ? { details: { dateOfBirth: dobIso, address: address.trim(), county: county.trim(), eircode: eircode.trim(), gpName: gpName.trim() } } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.url) {
        window.location.href = d.url;
        return;
      }
      setError(d.error ?? d.message ?? `We couldn't open the payment page. Nothing has been charged. Please call us on ${CLINIC_PHONE}.`);
      if (d.code && d.code !== "slot_held") setLink((l) => (l ? { ...l, status: d.code === "paid" ? "paid" : d.code === "slot_taken" ? l.status : "expired" } : l));
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

  if (loadError) {
    return shell(
      <Notice tone="error" title={loadError === "not_found" ? "This payment link isn't valid" : "We couldn't load this payment link"} actions={call}>
        <p>Please call us and we&apos;ll sort it out.</p>
      </Notice>
    );
  }
  if (!link) return shell(<p className="secondary">Loading…</p>);

  const line = checkoutLineItem(link.appointmentTypeName, link.startsAtISO);

  if (link.status !== "pending") {
    const msg =
      link.status === "paid"
        ? { tone: "success" as const, title: "Already paid", text: "This appointment is paid for and booked. Your confirmation email has the details." }
        : link.status === "expired" && link.waitlist
          ? { tone: "warning" as const, title: "This offer has ended", text: "The time wasn't taken within 2 hours, so it has gone to the next person. You're still on the waitlist, and we'll let you know when another time opens up." }
          : link.status === "rebook"
          ? { tone: "warning" as const, title: "Already paid: please pick another time", text: "The time was taken just before your payment went through. Your payment is kept for you: we've emailed you a link to pick another time, with no need to pay again." }
          : link.status === "expired"
          ? { tone: "warning" as const, title: "This link has expired", text: "The time is no longer held for you. Please call us and we'll find you a time." }
          : { tone: "warning" as const, title: "This link is no longer active", text: "Please call us and we'll sort it out." };
    return shell(
      <div className="stack-5">
        <h1>{line.name}</h1>
        <Notice tone={msg.tone} title={msg.title} actions={link.status === "paid" ? <a className="btn btn-secondary" href="/manage">Manage booking</a> : call}>
          <p>{msg.text}</p>
        </Notice>
      </div>
    );
  }

  return shell(
    <div className="stack-5">
      <div className="page-intro">
        <h1>{link.waitlist ? "A time has opened up" : "Pay for your appointment"}</h1>
        <p className="lede">
          {link.waitlist
            ? `Hi ${link.firstName}, a time has opened up from the waitlist. It's held for you until ${timeShort(link.expiresAt)}; after that it goes to the next person.`
            : `Hi ${link.firstName}, here's what we booked on the phone. The time is held for you until ${timeShort(link.expiresAt)}.`}
        </p>
        {link.waitlist && link.leavePath && (
          <p>
            <a href={link.leavePath}>Don&apos;t need this time? Pause or leave the waitlist</a>
          </p>
        )}
      </div>

      {cancelled && (
        <Notice title="You didn't finish paying, so nothing has been charged">
          <p>Your time is still held. Pay when you&apos;re ready.</p>
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
            {whenLong(link.startsAtISO)} · {link.durationMinutes} min
          </dd>
        </div>
        <div className="summary-row">
          <dt>Who</dt>
          <dd>{link.practitionerName}</dd>
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
        <span className="amount-due-label">Paid in full now</span>
        <span className="amount">{euro(link.amountMinor)}</span>
      </div>
      <p className="secondary">{EXTRAS_SENTENCE}</p>
      </div>

      {showErrors && <ProblemSummary ref={summaryRef} problems={problems} />}

      {link.needsDetails && (
        <fieldset className="stack-3">
          <legend className="label">A few details for your record</legend>
          <p className="secondary">We ask everyone who&apos;s new to us. They go on your patient record at the clinic.</p>
          <div className="field date-field">
            <p className="label" id="wl-dob-label">Date of birth</p>
            {showErrors && !isPlausibleDateOfBirth(dobIso) && (
              <p className="field-error" id="wl-dob-error">
                <Icon name="alert" />
                <span><span className="visually-hidden">Error: </span>Enter a real date of birth, like 2 4 1958</span>
              </p>
            )}
            <div className="date-parts" role="group" aria-labelledby="wl-dob-label" style={{ display: "flex", gap: "var(--space-3)" }}>
              {([["d", "Day", 2, "bday-day"], ["m", "Month", 2, "bday-month"], ["y", "Year", 4, "bday-year"]] as const).map(([k, label, max, ac]) => (
                <div className="date-part" key={k}>
                  <label htmlFor={`wl-dob-${k}`}>{label}</label>
                  <input
                    id={`wl-dob-${k}`}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete={ac}
                    maxLength={max}
                    style={{ width: k === "y" ? "5.5em" : "3.5em" }}
                    aria-invalid={(showErrors && !isPlausibleDateOfBirth(dobIso)) || undefined}
                    aria-describedby={showErrors && !isPlausibleDateOfBirth(dobIso) ? "wl-dob-error" : undefined}
                    value={dob[k]}
                    onChange={(e) => setDob({ ...dob, [k]: e.target.value.replace(/\D/g, "").slice(0, max) })}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="wl-address">Address</label>
            {showErrors && !address.trim() && (
              <p className="field-error" id="wl-address-error"><Icon name="alert" /><span><span className="visually-hidden">Error: </span>Enter your address</span></p>
            )}
            <input id="wl-address" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} aria-invalid={(showErrors && !address.trim()) || undefined} aria-describedby={showErrors && !address.trim() ? "wl-address-error" : undefined} />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="wl-county">County (optional)</label>
              <input id="wl-county" autoComplete="address-level1" value={county} onChange={(e) => setCounty(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="wl-eircode">Eircode (optional)</label>
              <input id="wl-eircode" autoComplete="postal-code" className="input-short" value={eircode} onChange={(e) => setEircode(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="wl-gp">Your GP</label>
            {showErrors && !gpName.trim() && (
              <p className="field-error" id="wl-gp-error"><Icon name="alert" /><span><span className="visually-hidden">Error: </span>Enter your GP&apos;s name</span></p>
            )}
            <input id="wl-gp" value={gpName} onChange={(e) => setGpName(e.target.value)} aria-invalid={(showErrors && !gpName.trim()) || undefined} aria-describedby={showErrors && !gpName.trim() ? "wl-gp-error" : undefined} />
          </div>
        </fieldset>
      )}

      <div className="stack-2">
        <p className="policy-line">{POLICY_SENTENCE}</p>
        <p className="secondary">
          <a href="/cancellation-policy" target="_blank" rel="noreferrer">
            Read the cancellation policy<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </p>
      </div>

      <div className="field">
        {showErrors && !policy && (
          <p className="field-error" id="policy-error">
            <Icon name="alert" />
            <span>
              <span className="visually-hidden">Error: </span>Tick the box to agree before you pay
            </span>
          </p>
        )}
        <label className="checkbox">
          <input
            ref={policyRef}
            id="pay-policy"
            type="checkbox"
            checked={policy}
            onChange={(e) => setPolicy(e.target.checked)}
            aria-invalid={(showErrors && !policy) || undefined}
            aria-describedby={showErrors && !policy ? "policy-error" : undefined}
          />
          <span>
            I agree to the cancellation policy. I authorise Northbank to save my card securely with Stripe and charge it for extra treatment I agree
            to on the day, for future bookings I make, or under the cancellation policy.
          </span>
        </label>
      </div>

      <div className="field consent-block">
        <p className="label" id="privacy-title">
          {PRIVACY_CONSENT_TITLE}
        </p>
        <p className="secondary" id="privacy-text">
          {PRIVACY_CONSENT_TEXT}{" "}
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
            Read our privacy notice<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </p>
        {showErrors && !privacy && (
          <p className="field-error" id="privacy-error">
            <Icon name="alert" />
            <span>
              <span className="visually-hidden">Error: </span>Tick &ldquo;I agree&rdquo; before you pay
            </span>
          </p>
        )}
        <label className="checkbox">
          <input
            ref={privacyRef}
            id="pay-privacy"
            type="checkbox"
            checked={privacy}
            onChange={(e) => setPrivacy(e.target.checked)}
            aria-invalid={(showErrors && !privacy) || undefined}
            aria-describedby={["privacy-title", "privacy-text", showErrors && !privacy ? "privacy-error" : ""].filter(Boolean).join(" ")}
          />
          <span>{PRIVACY_CONSENT_LABEL}</span>
        </label>
      </div>

      <div className="field consent-block">
        <label className="checkbox">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} aria-describedby="marketing-hint" />
          <span>{MARKETING_OPT_IN_LABEL}</span>
        </label>
        <p className="secondary" id="marketing-hint">
          {MARKETING_OPT_IN_HINT}
        </p>
      </div>

      {error && (
        <Notice tone="error" title="Payment didn't start" actions={call}>
          <p>{error}</p>
        </Notice>
      )}

      <div className="stack-3">
        <button className="btn btn-primary btn-block" onClick={pay} disabled={busy}>
          {busy ? "Opening secure payment…" : `Pay ${euro(link.amountMinor)}`}
        </button>
        <p className="handoff">Next, you&apos;ll pay on Stripe, our secure payment provider. You&apos;ll come straight back here.</p>
      </div>
    </div>
  );
}
