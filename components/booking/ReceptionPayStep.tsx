"use client";

import type { PatientKind } from "@/core/patient-kind";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Avatar, Icon, Notice } from "@/components/Brand";
import { EXTRAS_SENTENCE, POLICY_SENTENCE, PRIVACY_CONSENT_TEXT, euro } from "@/core/policy";
import { checkoutLineItem, eur, timeShort, whenShort } from "@/core/format";
import { phoneCardScript } from "@/core/phone-booking";
import { agreementSentence } from "@/core/phone-saved-card";
import type { AppointmentType, Patient, Practitioner, Step } from "./types";

/**
 * Step 5 when reception books a patient over the phone (clinic decision,
 * 8 Oct 2026). The patient pays one of three ways:
 *   - a link by email, or the same link by text: the time is held for 2
 *     hours and the appointment is booked automatically once they pay;
 *   - the same emailed link, opened here in a new tab so staff (the answering service)
 *     type the card in on the payment page while the patient is on the call
 *     (clinic decision, 29 Oct 2026). The email is the patient's backup;
 *   - their card, read out and typed into Stripe's own card box (MOTO),
 *     after reception reads the consent script. Only when switched on;
 *   - a returning patient picked from Cliniko: the card they saved with this
 *     therapist, charged now once staff tick that they agreed on the call
 *     (core/phone-saved-card.ts). If their bank wants them to approve it,
 *     they're emailed a link to approve that same payment and this screen
 *     waits, the time held, until it's paid. Only if it's declined, they
 *     can't approve it or the link expires is "Send a payment link instead"
 *     offered.
 * The money goes to the attending therapist's own Stripe account either way.
 */

type Options = { email: boolean; sms: boolean; phoneCard: boolean };
type Method = "email" | "sms" | "card" | "page" | "saved";
type LinkResult = { url: string; expiresAt: string; sent: boolean; sendError?: string; diaryWarning?: string; openedHere?: boolean };

declare global {
  interface Window {
    Stripe?: (key: string, opts?: { stripeAccount?: string }) => any;
  }
}

/** Stripe.js, loaded only on this staff page and only when the card box is opened. */
function loadStripeJs(): Promise<NonNullable<Window["Stripe"]>> {
  return new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe);
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.async = true;
    s.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe didn't load")));
    s.onerror = () => reject(new Error("Stripe didn't load"));
    document.head.appendChild(s);
  });
}

export default function ReceptionPayStep({
  adminKey,
  ownOnly = false,
  type,
  practitioner,
  businessId,
  startsAtISO,
  patient,
  visit,
  onChange,
  onSlotGone,
  onDone,
  clinikoPatientId,
  headingRef,
}: {
  adminKey: string;
  /** A therapist booking their own patient: payment link only, no bookings page. */
  ownOnly?: boolean;
  type: AppointmentType;
  practitioner: Practitioner;
  businessId: string;
  startsAtISO: string;
  patient: Patient;
  visit?: PatientKind | null;
  onChange: (s: Step) => void;
  onSlotGone: (message: string) => void;
  /** The link is made or the card taken: the booking in progress is forgotten (core/phone-draft.ts). */
  onDone?: () => void;
  /** Picked in the patient lookup: the booking goes on this Cliniko record (the server checks the name still matches). */
  clinikoPatientId?: string;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  // No key = signed in to the dashboard: the session cookie is sent instead.
  const auth: Record<string, string> = { ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}), "Content-Type": "application/json" };
  const [options, setOptions] = useState<Options | null>(null);
  // Reception (the answering service) mostly take the card on the call; a therapist booking their own patient sends a link.
  const [method, setMethod] = useState<Method>(ownOnly ? "email" : "page");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkResult, setLinkResult] = useState<LinkResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Card over the phone
  const [agreed, setAgreed] = useState(false);
  const [attempt, setAttempt] = useState<{ attemptId: string; amountMinor: number } | null>(null);
  const [cardDone, setCardDone] = useState<string | null>(null);
  // Their card saved with this therapist (only for a patient picked from Cliniko), and why it wasn't charged if it wasn't.
  const [savedCard, setSavedCard] = useState<{ brand: string; last4: string } | null>(null);
  const [savedAgreed, setSavedAgreed] = useState(false);
  const [notCharged, setNotCharged] = useState<string | null>(null);
  // Waiting for the patient to approve the payment with their bank (lib/approvals.ts).
  const [approval, setApproval] = useState<{ id: string; status: string; message: string; expiresAt: string; url: string; emailed: boolean } | null>(null);
  const [copiedApproval, setCopiedApproval] = useState(false);
  const methodChosen = useRef(false);
  const stripeRef = useRef<any>(null);
  const cardRef = useRef<any>(null);
  const cardMount = useRef<HTMLDivElement>(null);

  const price = type.fullPriceEUR ?? 0;
  const line = checkoutLineItem(type.name, startsAtISO);
  const slot = { practitionerId: practitioner.id, appointmentTypeId: type.id, businessId, startsAtISO, ...(visit ? { visit } : {}), ...(clinikoPatientId ? { clinikoPatientId } : {}) };

  useEffect(() => {
    fetch("/api/admin/phone-booking", { headers: auth })
      .then((r) => r.json())
      .then((d) => setOptions({ email: true, sms: !!d.sms, phoneCard: !!d.phoneCard }))
      .catch(() => setOptions({ email: true, sms: false, phoneCard: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);

  useEffect(() => {
    setSavedCard(null);
    if (!clinikoPatientId || ownOnly || adminKey) return;
    let cancelled = false;
    fetch("/api/admin/saved-card", { method: "POST", headers: auth, body: JSON.stringify({ action: "find", clinikoPatientId, practitionerId: practitioner.id }) })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.card) return;
        setSavedCard(d.card);
        if (!methodChosen.current) setMethod("saved");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinikoPatientId, practitioner.id, ownOnly, adminKey]);

  const choose = (m: Method) => {
    methodChosen.current = true;
    setMethod(m);
  };

  function handleError(res: Response, data: any) {
    if (data?.code === "slot_taken" || data?.code === "slot_held") return onSlotGone(data.error);
    if (res.status === 401) return setError("The admin key wasn't accepted. Sign in again on the online bookings page.");
    setError(data?.error ?? "Something went wrong. Nothing was sent or charged.");
  }

  async function sendLink(override?: Method) {
    const m = override ?? method;
    const payHere = m === "page";
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
    setError(null);
    let opened = false;
    try {
      const res = await fetch("/api/admin/phone-booking", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ ...slot, patient, channel: payHere ? "email" : m }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return handleError(res, data);
      if (win && typeof data.url === "string") {
        win.location.href = data.url;
        opened = true;
      }
      setLinkResult({ url: data.url, expiresAt: data.expiresAt, sent: data.sent, sendError: data.sendError, diaryWarning: data.diaryWarning, openedHere: opened });
    } catch {
      setError("Couldn't reach the Hub. Nothing was sent. Check the connection and try again.");
    } finally {
      if (win && !opened) win.close();
      setBusy(false);
    }
  }

  /** Charge their saved card. The bank wants approval: wait for the patient. Declined: offer a payment link. */
  async function chargeSaved() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/saved-card", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ action: "charge", ...slot, clinikoPatientId, patient, amountMinor: Math.round(price * 100), agreed: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) return setCardDone(data.message);
      if (res.status === 202 && data.waiting) {
        return setApproval({ id: data.approvalId, status: "waiting", message: data.message, expiresAt: data.expiresAt, url: data.url, emailed: !!data.emailed });
      }
      if (data.fallback) return setNotCharged(data.message);
      handleError(res, data);
    } catch {
      setError("Couldn't reach the Hub. Check Online bookings before trying again, in case it went through.");
    } finally {
      setBusy(false);
    }
  }

  /** Declined, couldn't approve, or the approval link ran out: email the payment link (cancelling a waiting payment first). */
  async function sendLinkInstead() {
    setBusy(true);
    setError(null);
    try {
      if (approval && (approval.status === "waiting" || approval.status === "failed")) {
        const res = await fetch("/api/admin/saved-card", { method: "POST", headers: auth, body: JSON.stringify({ action: "cancel", approvalId: approval.id }) });
        const data = await res.json().catch(() => ({}));
        if (data.status === "paid") return setCardDone(data.message);
        if (data.status !== "cancelled") return setError(data.error ?? data.message ?? "Couldn't cancel the waiting payment. Try again in a moment.");
        setNotCharged(approval.message);
      }
      setMethod("email");
      setBusy(false);
      await sendLink("email");
    } catch {
      setError("Couldn't reach the Hub. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // While waiting for the patient to approve: check every few seconds (checking books it once approved).
  const approvalId = approval?.id;
  const approvalOpen = approval?.status === "waiting" || approval?.status === "failed";
  useEffect(() => {
    if (!approvalId || !approvalOpen) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/admin/saved-card", { method: "POST", headers: auth, body: JSON.stringify({ action: "status", approvalId }) });
        const data = await res.json().catch(() => ({}));
        if (stopped || !res.ok || !data.status) return;
        if (data.status === "paid") setCardDone(data.message);
        setApproval((a) => (a ? { ...a, status: data.status, message: data.message ?? a.message } : a));
      } catch {
        /* try again next time */
      }
    };
    const timer = setInterval(tick, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalId, approvalOpen]);

  async function openCardBox() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/phone-card/start", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ ...slot, patient, verbalConsent: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return handleError(res, data);
      const StripeJs = await loadStripeJs();
      const stripe = StripeJs(data.publishableKey, data.stripeAccount ? { stripeAccount: data.stripeAccount } : undefined);
      stripeRef.current = stripe;
      setAttempt({ attemptId: data.attemptId, amountMinor: data.amountMinor });
      // Mount after render, once the box's container exists.
      setTimeout(() => {
        const card = stripe.elements().create("card", { hidePostalCode: true, style: { base: { fontSize: "18px" } } });
        card.mount(cardMount.current);
        cardRef.current = card;
      }, 0);
    } catch {
      setError("Couldn't open Stripe's card box. Nothing was charged. Send a payment link instead.");
    } finally {
      setBusy(false);
    }
  }

  async function takePayment() {
    if (!attempt || !stripeRef.current || !cardRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const { paymentMethod, error: pmError } = await stripeRef.current.createPaymentMethod({ type: "card", card: cardRef.current });
      if (pmError) return setError(pmError.message ?? "Check the card details.");
      const res = await fetch("/api/admin/phone-card/confirm", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ attemptId: attempt.attemptId, paymentMethodId: paymentMethod.id }),
      });
      const data = await res.json().catch(() => ({}));
      cardRef.current?.clear?.();
      if (!res.ok) {
        setAttempt(null);
        return setError(data.error ?? "The payment didn't go through.");
      }
      setCardDone(data.message);
    } catch {
      setError("Couldn't reach the Hub. Check Online bookings before trying again, in case it went through.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (linkResult || cardDone || approval) onDone?.();
  }, [linkResult, cardDone, approval, onDone]);

  // ---------------------------------------------------------------- done screens

  if (linkResult) {
    return (
      <section className="stack-5">
        <div className="step-head">
          <h1 ref={headingRef} tabIndex={-1}>
            {method === "page" ? "Take the payment on the payment page" : linkResult.sent ? "Payment link sent" : "Payment link made, but not sent"}
          </h1>
        </div>
        {notCharged && (
          <Notice tone="warning" title="Their saved card wasn't charged">
            <p>
              {notCharged} We&apos;ve emailed {patient.firstName} the payment link instead. Tell them, or open it with them now and type a card
              in on the payment page.
            </p>
            <p>
              <a className="btn btn-secondary" href={linkResult.url} target="_blank" rel="noopener noreferrer">
                Open the payment page
              </a>
            </p>
          </Notice>
        )}
        {method === "page" && (
          <Notice tone="info" title={linkResult.openedHere ? "The payment page is open in a new tab" : "Open the payment page"}>
            <p>
              Keep {patient.firstName} on the call. Read them the cancellation policy and the privacy agreement on the page, and tick the box
              only once they say yes. Then type their card as they read it out. If their bank asks them to approve it in their banking app,
              wait while they do.
            </p>
            <p>
              <a className="btn btn-primary" href={linkResult.url} target="_blank" rel="noopener noreferrer">
                {linkResult.openedHere ? "Open it again" : "Open the payment page"}
              </a>
            </p>
          </Notice>
        )}
        {linkResult.sent ? (
          <Notice tone="success" title={`${method === "page" ? "Also sent" : "Sent"} by ${method === "sms" ? `text to ${patient.phone}` : `email to ${patient.email}`}`}>
            <p>
              The time is held until <strong>{timeShort(linkResult.expiresAt)}</strong>
              {linkResult.diaryWarning ? "" : " (it shows as HELD in the therapist's Cliniko diary)"}. Once {patient.firstName} pays, the appointment goes into
              Cliniko automatically and Cliniko sends the confirmation. If they don&apos;t pay by then, the link lapses and the time is freed.
            </p>
          </Notice>
        ) : (
          <Notice tone="warning" title="The message didn't go">
            <p>{linkResult.sendError}</p>
            <p>The link below still works and the time is held until {timeShort(linkResult.expiresAt)}. Read it out, or send it another way.</p>
          </Notice>
        )}
        {linkResult.diaryWarning && (
          <Notice tone="warning" title="Not blocked in Cliniko">
            <p>{linkResult.diaryWarning}</p>
          </Notice>
        )}
        <div className="field">
          <label htmlFor="pay-link">The link (only for this patient)</label>
          <div className="inline-form">
            <input id="pay-link" readOnly value={linkResult.url} onFocus={(e) => e.target.select()} />
            <button
              className="btn btn-secondary"
              onClick={() => {
                navigator.clipboard?.writeText(linkResult.url).then(() => setCopied(true), () => {});
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <div className="actions">
          <a className="btn btn-primary" href={adminKey ? "/admin/book" : "/dashboard/book"}>
            Book another patient
          </a>
          {ownOnly ? (
            <a className="btn btn-secondary" href="/dashboard">
              Back to the dashboard
            </a>
          ) : (
            <a className="btn btn-secondary" href={adminKey ? "/admin/bookings" : "/dashboard/bookings"}>
              Online bookings and payment links
            </a>
          )}
        </div>
      </section>
    );
  }

  if (approval && !cardDone) {
    const open = approval.status === "waiting" || approval.status === "failed";
    const offerLink = approval.status === "failed" || approval.status === "expired";
    return (
      <section className="stack-5">
        <div className="step-head">
          <h1 ref={headingRef} tabIndex={-1}>
            {approval.status === "waiting"
              ? "Waiting for the patient to approve"
              : approval.status === "failed"
                ? "They couldn't approve the payment"
                : approval.status === "expired"
                  ? "The approval link expired"
                  : "Not booked"}
          </h1>
        </div>
        {approval.status === "waiting" && (
          <Notice tone="info" title={`${euro(Math.round(price * 100))} on the card ending ${savedCard?.last4 ?? "…"}`}>
            <p>{approval.message}</p>
            <p>
              The time is held until <strong>{timeShort(approval.expiresAt)}</strong>. As soon as {patient.firstName} approves it, it&apos;s paid
              and booked, and this page changes to Paid by itself.
            </p>
          </Notice>
        )}
        {approval.status !== "waiting" && (
          <Notice tone={offerLink ? "warning" : "error"} title={offerLink ? "Nothing was charged" : "Check this booking"}>
            <p>{approval.message}</p>
          </Notice>
        )}
        {open && (
          <div className="field">
            <label htmlFor="approval-link">Their approval link (only for this patient)</label>
            <div className="inline-form">
              <input id="approval-link" readOnly value={approval.url} onFocus={(e) => e.target.select()} />
              <button
                className="btn btn-secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(approval.url).then(() => setCopiedApproval(true), () => {});
                }}
              >
                {copiedApproval ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
        {error && (
          <Notice tone="error" title="Not done">
            <p>{error}</p>
          </Notice>
        )}
        <div className="actions">
          {offerLink && (
            <button className="btn btn-primary" onClick={sendLinkInstead} disabled={busy}>
              {busy ? "Sending…" : "Send a payment link instead"}
            </button>
          )}
          <a className={offerLink ? "btn btn-secondary" : "btn btn-primary"} href={adminKey ? "/admin/book" : "/dashboard/book"}>
            Book another patient
          </a>
          <a className="btn btn-secondary" href={adminKey ? "/admin/bookings" : "/dashboard/bookings"}>
            Online bookings and payment links
          </a>
        </div>
      </section>
    );
  }

  if (cardDone) {
    return (
      <section className="stack-5">
        <div className="banner is-success">
          <Icon name="check" className="banner-icon" />
          <div className="stack-2">
            <h1 ref={headingRef} tabIndex={-1}>
              Paid and booked
            </h1>
            <p>{cardDone}</p>
          </div>
        </div>
        <div className="actions">
          <a className="btn btn-primary" href={adminKey ? "/admin/book" : "/dashboard/book"}>
            Book another patient
          </a>
          <a className="btn btn-secondary" href={adminKey ? "/admin/bookings" : "/dashboard/bookings"}>
            Online bookings
          </a>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- review

  const script = phoneCardScript({ amount: eur(price), policySentence: POLICY_SENTENCE, privacyText: PRIVACY_CONSENT_TEXT });

  return (
    <section>
      <div className="step-head">
        <p className="progress">Step 5 of 5</p>
        <h1 ref={headingRef} tabIndex={-1}>
          Review and take payment
        </h1>
      </div>

      <div className="checkout">
        <div className="checkout-summary">
          <div className="checkout-what">
            <h2>{line.name}</h2>
            <p className="tnum">{line.description}</p>
          </div>
          <dl className="summary-list">
            <div className="summary-row">
              <dt>Practitioner</dt>
              <dd className="checkout-who">
                <Avatar name={practitioner} url={practitioner.profilePictureUrl} small />
                <span>
                  {practitioner.firstName} {practitioner.lastName}
                </span>
              </dd>
              <dd className="summary-change">
                <button className="link-button" onClick={() => onChange(2)} disabled={busy || !!attempt}>
                  Change<span className="visually-hidden"> practitioner</span>
                </button>
              </dd>
            </div>
            <div className="summary-row">
              <dt>When</dt>
              <dd className="tnum">
                {whenShort(startsAtISO)} · {type.durationMinutes} min
              </dd>
              <dd className="summary-change">
                <button className="link-button" onClick={() => onChange(3)} disabled={busy || !!attempt}>
                  Change<span className="visually-hidden"> time</span>
                </button>
              </dd>
            </div>
            <div className="summary-row">
              <dt>Patient</dt>
              <dd>
                {patient.firstName} {patient.lastName}
                <br />
                <span className="secondary">
                  {patient.email} · {patient.phone}
                </span>
              </dd>
              <dd className="summary-change">
                <button className="link-button" onClick={() => onChange(4)} disabled={busy || !!attempt}>
                  Change<span className="visually-hidden"> patient details</span>
                </button>
              </dd>
            </div>
          </dl>
          <div className="amount-due">
            <span className="amount-due-label">Paid in full now</span>
            <span className="amount">{eur(price)}</span>
          </div>
          <p className="secondary">Tell them: {EXTRAS_SENTENCE}</p>
        </div>

        <div className="checkout-commit">
          {!options && <p className="secondary">Loading payment options…</p>}
          {options && !attempt && (
            <fieldset className="radio-list">
              <legend className="label">How will the patient pay?</legend>
              {savedCard && (
                <label className="radio">
                  <input type="radio" name="method" checked={method === "saved"} onChange={() => choose("saved")} />
                  <span>
                    <span className="radio-label">Charge their saved card (ending {savedCard.last4})</span>
                    <span className="radio-hint">
                      The card they saved with {practitioner.firstName}. Paid and booked now, no link needed.
                    </span>
                  </span>
                </label>
              )}
              <label className="radio">
                <input type="radio" name="method" checked={method === "page"} onChange={() => choose("page")} />
                <span>
                  <span className="radio-label">Take their card now, on the payment page</span>
                  <span className="radio-hint">Opens the payment page in a new tab. The link is emailed to {patient.email} too.</span>
                </span>
              </label>
              <label className="radio">
                <input type="radio" name="method" checked={method === "email"} onChange={() => choose("email")} />
                <span>
                  <span className="radio-label">Email them a payment link</span>
                  <span className="radio-hint">To {patient.email}. The time is held for 2 hours.</span>
                </span>
              </label>
              {options.sms && (
                <label className="radio">
                  <input type="radio" name="method" checked={method === "sms"} onChange={() => choose("sms")} />
                  <span>
                    <span className="radio-label">Text them a payment link</span>
                    <span className="radio-hint">To {patient.phone}. The text has the link and the date only.</span>
                  </span>
                </label>
              )}
              {options.phoneCard && (
                <label className="radio">
                  <input type="radio" name="method" checked={method === "card"} onChange={() => choose("card")} />
                  <span>
                    <span className="radio-label">Take their card now</span>
                    <span className="radio-hint">They read it out; you type it into Stripe&apos;s box.</span>
                  </span>
                </label>
              )}
            </fieldset>
          )}

          {options && method === "saved" && savedCard && (
            <div className="stack-3">
              <p className="secondary">Ask them if you can charge it, and tick only once they say yes.</p>
              <label className="checkbox">
                <input type="checkbox" checked={savedAgreed} onChange={(e) => setSavedAgreed(e.target.checked)} />
                <span>{agreementSentence(Math.round(price * 100), type.name, startsAtISO)}</span>
              </label>
              {notCharged ? (
                <Notice
                  tone="warning"
                  title="Their saved card wasn't charged"
                  actions={
                    <button className="btn btn-primary" onClick={sendLinkInstead} disabled={busy}>
                      {busy ? "Sending…" : "Send a payment link instead"}
                    </button>
                  }
                >
                  <p>{notCharged}</p>
                </Notice>
              ) : (
                <button className="btn btn-primary btn-block" onClick={chargeSaved} disabled={busy || !savedAgreed}>
                  {busy ? "Charging…" : `Charge ${eur(price)} to the card ending ${savedCard.last4}`}
                </button>
              )}
            </div>
          )}

          {options && method !== "card" && method !== "saved" && (
            <div className="stack-3">
              {method === "page" ? (
                <p className="secondary">
                  Keep them on the call. On the payment page, read them the cancellation policy and the privacy agreement and tick the box only
                  once they say yes, then type their card as they read it out. The appointment is booked as soon as it&apos;s paid.
                </p>
              ) : (
                <p className="secondary">
                  On the payment page they&apos;ll agree to the cancellation policy and the privacy agreement themselves, then pay on Stripe. The
                  appointment is booked as soon as they&apos;ve paid.
                </p>
              )}
              <button className="btn btn-primary btn-block" onClick={() => sendLink()} disabled={busy}>
                {busy
                  ? method === "page"
                    ? "Opening…"
                    : "Sending…"
                  : method === "page"
                    ? `Open the ${eur(price)} payment page`
                    : method === "sms"
                      ? `Text the ${eur(price)} payment link`
                      : `Email the ${eur(price)} payment link`}
              </button>
            </div>
          )}

          {options && method === "card" && !attempt && (
            <div className="stack-3">
              <div className="notice">
                <Icon name="info" />
                <div className="notice-body">
                  <p className="notice-title">Read this to the patient</p>
                  {script.slice(0, 4).map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                </div>
              </div>
              <p className="secondary">
                <strong>Card rules:</strong> {script[4]}
              </p>
              <label className="checkbox">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>I read this out and the patient agreed to both, on this call.</span>
              </label>
              <button className="btn btn-primary btn-block" onClick={openCardBox} disabled={busy || !agreed}>
                {busy ? "Opening…" : "Open the card box"}
              </button>
            </div>
          )}

          {attempt && (
            <div className="stack-3">
              <label className="label" htmlFor="card-box">
                Card details (Stripe)
              </label>
              {attempt.amountMinor !== Math.round(price * 100) && (
                <Notice tone="warning" title="The price has changed">
                  <p>
                    Cliniko now says {euro(attempt.amountMinor)}, not the {eur(price)} you read out. Tell the patient the new amount and check
                    they agree before taking it.
                  </p>
                </Notice>
              )}
              <div id="card-box" ref={cardMount} className="card-box" />
              <p className="secondary">Type only into this box. Don&apos;t write the number down or read it back.</p>
              <button className="btn btn-primary btn-block" onClick={takePayment} disabled={busy}>
                {busy ? "Taking payment…" : `Take ${euro(attempt.amountMinor)}`}
              </button>
            </div>
          )}

          {error && (
            <Notice tone="error" title="Not done">
              <p>{error}</p>
            </Notice>
          )}
        </div>
      </div>
    </section>
  );
}
