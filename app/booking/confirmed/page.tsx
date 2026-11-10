"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { CLINIC_MAP_URL, CLINIC_PHONE, CLINIC_TEL, EXTRAS_SENTENCE, POLICY_SENTENCE } from "@/core/policy";
import { CLINIC_ADDRESS, eur, whenLong } from "@/core/format";
import { clearDraft, readDraft, type BookingDraft } from "@/components/booking/types";

/**
 * Tells the patient what really happened. After Stripe Checkout, the
 * booking is made by the webhook a few seconds later — so this page asks
 * /api/booking-status until it knows, instead of assuming success.
 * The saved-card path books before redirecting, and arrives with ?booked=1.
 *
 * Who/amount come from what the patient chose (kept in this tab while they
 * were on Stripe); what/when come from the server when it has them.
 */

// Clothing line is the clinic's own wording (Oct 2026).
const WHAT_TO_BRING = [
  "Wear loose, comfortable activewear or clothing that lets you move freely and gives the practitioner easy access to the area being treated or examined.",
  "Bring any scans, X-ray or MRI reports and referral letters you have.",
  "Bring a list of any medicines you take.",
  "For a first visit, please arrive 5 minutes early.",
];

type Status =
  | { state: "checking" }
  | { state: "booked"; startsAtISO?: string; appointmentTypeName?: string | null; reference?: string | null }
  | { state: "refunded"; reason?: string }
  | { state: "rebook" }
  | { state: "delayed" | "processing" | "unpaid" | "unknown" }
  // Opened without a payment to look up (a bookmark, a shared link, Back after leaving Stripe).
  | { state: "no_session" };

function icsFor(opts: { startsAtISO: string; durationMinutes?: number; title: string; who?: string; reference?: string | null }) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(opts.startsAtISO);
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
  const manage = `${window.location.origin}/manage`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Northbank//Hub//EN",
    "BEGIN:VEVENT",
    `UID:${opts.reference ? `appt-${opts.reference}` : stamp(start)}@northbank.example`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    opts.durationMinutes ? `DURATION:PT${opts.durationMinutes}M` : "",
    `SUMMARY:${esc(`${opts.title} at Northbank`)}`,
    `LOCATION:${esc(`Northbank, ${CLINIC_ADDRESS}`)}`,
    `DESCRIPTION:${esc(`${opts.who ? `With ${opts.who}. ` : ""}To change or cancel: ${manage} or call ${CLINIC_PHONE}.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
}

export default function ConfirmedPage() {
  const [status, setStatus] = useState<Status>({ state: "checking" });
  const [draft, setDraft] = useState<BookingDraft | null>(null);

  useEffect(() => {
    setDraft(readDraft());
    const params = new URLSearchParams(window.location.search);
    if (params.get("booked") === "1") {
      setStatus({ state: "booked" });
      return;
    }
    const sessionId = params.get("session_id");
    // Missing, or not a Stripe Checkout id (a mangled or hand-typed link): nothing to look up.
    if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      setStatus({ state: "no_session" });
      return;
    }
    let stopped = false;
    let tries = 0;
    const poll = async () => {
      tries += 1;
      try {
        const res = await fetch(`/api/booking-status?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        if (stopped) return;
        // The server doesn't know this session at all: say so now, not "payment received" a minute later.
        if (res.status === 400 || res.status === 404) return setStatus({ state: "no_session" });
        const data = await res.json();
        const final = ["booked", "refunded", "rebook", "delayed", "unpaid"].includes(data.state);
        if (final || tries >= 20) {
          setStatus(final ? data : { state: data.state === "processing" ? "processing" : "unknown" });
          return;
        }
      } catch {
        if (tries >= 20) return setStatus({ state: "unknown" });
      }
      setTimeout(poll, tries < 5 ? 1500 : 3000);
    };
    poll();
    return () => {
      stopped = true;
    };
  }, []);

  // Once the outcome is final, the draft has done its job (kept for "unpaid" so Try again restores it).
  useEffect(() => {
    if (status.state === "booked" || status.state === "refunded" || status.state === "rebook") clearDraft();
  }, [status.state]);

  const shell = (body: ReactNode) => (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow" aria-live="polite">
        {body}
      </main>
    </>
  );

  const callButton = (
    <a className="btn btn-secondary" href={CLINIC_TEL}>
      <Icon name="phone" /> Call {CLINIC_PHONE}
    </a>
  );

  if (status.state === "checking") {
    return shell(
      <div className="stack-5">
        <h1>Confirming your booking…</h1>
        <Notice icon="clock" title="Your payment went through">
          <p>We&apos;re putting your appointment in the diary. This takes a few seconds, so please keep this page open.</p>
        </Notice>
      </div>
    );
  }

  if (status.state === "booked") {
    const when = status.startsAtISO ?? draft?.startsAtISO;
    const what = status.appointmentTypeName ?? draft?.type.name;
    // Only trust the remembered choice if it's for this same appointment.
    const sameBooking = draft && (!status.startsAtISO || draft.startsAtISO === status.startsAtISO);
    const who = sameBooking ? `${draft!.practitioner.firstName} ${draft!.practitioner.lastName}` : null;
    const paid = sameBooking ? draft!.amountEUR : null;
    const paidLabel = "Paid in full";
    return shell(
      <div className="stack-6">
        <div className="banner is-success">
          <Icon name="check" className="banner-icon" />
          <div className="stack-2">
            <h1>You&apos;re booked</h1>
            <p>We&apos;ve emailed your confirmation. It can take a few minutes to arrive.</p>
          </div>
        </div>

        <dl className="summary-list is-wide">
          {what && (
            <div className="summary-row">
              <dt>What</dt>
              <dd>{what}</dd>
            </div>
          )}
          {when && (
            <div className="summary-row">
              <dt>When</dt>
              <dd className="tnum">{whenLong(when)}</dd>
            </div>
          )}
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
          {who && (
            <div className="summary-row">
              <dt>Who</dt>
              <dd>{who}</dd>
            </div>
          )}
          {paid != null && (
            <div className="summary-row">
              <dt>{paidLabel}</dt>
              <dd className="tnum">
                {eur(paid)}
                {sameBooking && draft!.voucherEUR ? (
                  <span className="secondary">
                    {" "}
                    ({draft!.voucherEUR >= paid ? "with your gift voucher" : `${eur(draft!.voucherEUR)} gift voucher, ${eur(paid - draft!.voucherEUR)} card`})
                  </span>
                ) : null}
              </dd>
            </div>
          )}
          {status.reference && (
            <div className="summary-row">
              <dt>Reference</dt>
              <dd className="tnum">{status.reference}</dd>
            </div>
          )}
        </dl>

        <div className="actions">
          {when && (
            <a
              className="btn btn-secondary"
              href={icsFor({
                startsAtISO: when,
                durationMinutes: sameBooking ? draft!.type.durationMinutes : undefined,
                title: what ?? "Appointment",
                who: who ?? undefined,
                reference: status.reference,
              })}
              download="northbank-appointment.ics"
            >
              <Icon name="calendar" /> Add to calendar
            </a>
          )}
          <a className="btn btn-secondary" href="/manage">
            Manage booking
          </a>
        </div>

        <section className="prose">
          <h2>What to bring and wear</h2>
          <ul>
            {WHAT_TO_BRING.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <h2>Extra treatments</h2>
          <p>{EXTRAS_SENTENCE}</p>
          <h2>If you need to change it</h2>
          <p>
            {POLICY_SENTENCE} Use <a href="/manage">Manage booking</a> or call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a>.
          </p>
        </section>
      </div>
    );
  }

  if (status.state === "rebook") {
    return shell(
      <div className="stack-5">
        <h1>Please pick another time</h1>
        <Notice tone="warning" title="You've paid, and you won't need to pay again" actions={callButton}>
          <p>
            Someone else booked that time just before your payment went through. Your payment is kept for you: we&apos;ve emailed you a
            link to pick another time with the same therapist, and it&apos;s booked straight away. If you&apos;d rather have your money back,
            the same page has a &quot;Refund me instead&quot; button.
          </p>
        </Notice>
      </div>
    );
  }

  if (status.state === "refunded") {
    return shell(
      <div className="stack-5">
        <h1>We couldn&apos;t complete your booking</h1>
        <Notice
          tone="warning"
          title="You've been refunded in full"
          actions={
            <>
              <a className="btn btn-primary" href="/">
                Choose another time
              </a>
              {callButton}
            </>
          }
        >
          <p>
            {status.reason === "slot_taken"
              ? "Someone else booked that time just before your payment went through."
              : "A problem on our side meant we couldn't confirm your appointment."}{" "}
            The refund can take 5 to 10 working days to appear on your statement.
          </p>
        </Notice>
      </div>
    );
  }

  if (status.state === "unpaid") {
    return shell(
      <div className="stack-5">
        <h1>Payment not completed</h1>
        <Notice
          tone="error"
          title="Nothing has been booked or charged"
          actions={
            <>
              <a className="btn btn-primary" href={draft ? "/?cancelled=1" : "/"}>
                Try again
              </a>
              {callButton}
            </>
          }
        >
          <p>Your payment didn&apos;t go through, so your appointment isn&apos;t booked yet.</p>
        </Notice>
      </div>
    );
  }

  // Nothing to look up, so don't claim a payment (review, 15 Oct): this page
  // used to say "Payment received… the clinic has been told" to anyone.
  if (status.state === "no_session") {
    return shell(
      <div className="stack-5">
        <h1>We can&apos;t show a booking here</h1>
        <Notice
          title="This page only shows a booking straight after you pay"
          actions={
            <>
              <a className="btn btn-primary" href="/manage">
                Manage a booking
              </a>
              <a className="btn btn-secondary" href="/">
                Book an appointment
              </a>
            </>
          }
        >
          <p>
            If you&apos;ve booked, your confirmation email has the details, and you can see your bookings at Manage a booking. Or call us on{" "}
            <a href={CLINIC_TEL}>{CLINIC_PHONE}</a>.
          </p>
        </Notice>
      </div>
    );
  }

  // delayed / processing / unknown: paid, but not confirmed yet.
  return shell(
    <div className="stack-5">
      <h1>Payment received — confirming your appointment</h1>
      <Notice tone="warning" title="This is taking longer than usual" actions={callButton}>
        <p>
          Your payment went through, but your appointment is taking longer than usual to confirm. The clinic has been told and will
          make sure it&apos;s booked. You&apos;ll get a confirmation email once it is.
        </p>
        <p>
          If you don&apos;t hear from us within the hour, please call {CLINIC_PHONE}. If we can&apos;t book it, you&apos;ll be refunded in
          full automatically.
        </p>
      </Notice>
    </div>
  );
}
