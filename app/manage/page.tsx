"use client";

import { useEffect, useRef, useState } from "react";
import { ONLINE_BOOKING_WEEKS_AHEAD, dublinDay, onlineBookingWeeks } from "@/core/policy";
import { CANCEL_WINDOW_HOURS, CLINIC_PHONE, CLINIC_TEL, POLICY_SENTENCE, euro } from "@/lib/policy";
import { dayLabel, dayLong, dayShort, timeShort, whenLong } from "@/core/format";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { CodeEntry } from "@/components/booking/Steps";

/**
 * Patient self-service: cancel or move an online booking.
 * Linked from Cliniko's confirmation/reminder emails as /manage.
 * Presentation only: same requests and server rules as before the redesign.
 */

type Booking = {
  appointmentId: string;
  appointmentTypeName: string;
  /** Set only when several family members share the email. */
  patientFirstName?: string | null;
  appointmentTypeId: string;
  practitionerId: string;
  practitionerName: string;
  businessId: string;
  startsAtISO: string;
  paidOnline: boolean;
  paidMinor: number;
  paidInFull: boolean;
  fullPriceMinor?: number | null;
  freeCancellation: boolean;
  canCancelOnline: boolean;
  canReschedule: boolean;
};

/** One line of "Past payments": a card payment, a gift voucher's part, and anything refunded from it. */
type PastPayment = {
  id: string;
  paidAtISO: string;
  what: string;
  treatment: string;
  practitionerName: string;
  appointmentAtISO: string;
  cancelled: boolean;
  method: string;
  amountMinor: number;
  refundedMinor: number;
};

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** What happens if this booking is cancelled now, in words, and the button that does it. */
function cancelConsequence(b: Booking) {
  const fee = b.fullPriceMinor ? euro(b.fullPriceMinor) : null;
  if (b.freeCancellation) {
    if (b.paidMinor <= 0) return { text: "Cancel this appointment? There's nothing to pay.", button: "Cancel booking" };
    return { text: `Cancel this appointment? Your ${euro(b.paidMinor)} payment will be refunded in full.`, button: `Cancel, ${euro(b.paidMinor)} refunded` };
  }
  if (b.paidInFull) {
    return {
      text: `This appointment is less than ${CANCEL_WINDOW_HOURS} hours away, so the full appointment fee applies and your ${euro(b.paidMinor)} payment won't be refunded. If you had an emergency, please call us on ${CLINIC_PHONE} instead.`,
      button: `Cancel and lose ${euro(b.paidMinor)}`,
    };
  }
  // Part-paid: only bookings from before 8 Oct 2026, when a €50 deposit was taken.
  return {
    text:
      `This appointment is less than ${CANCEL_WINDOW_HOURS} hours away, so the full appointment fee${fee ? ` of ${fee}` : ""} applies. ` +
      (b.paidMinor > 0 ? `We keep your ${euro(b.paidMinor)} payment and charge the rest to the card you booked with.` : "It's charged to the card you booked with."),
    button: fee ? `Cancel and pay the ${fee} fee` : "Cancel and pay the full fee",
  };
}

export default function ManagePage() {
  const [stage, setStage] = useState<"email" | "code" | "list">("email");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [payments, setPayments] = useState<PastPayment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Per-booking UI state
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [times, setTimes] = useState<string[]>([]);
  const [timesLoading, setTimesLoading] = useState(false);
  const [newTime, setNewTime] = useState<string | null>(null);
  // Moving a booking: which week is on screen (0 = from today), and the first week with a free time (null = none).
  const [rWeek, setRWeek] = useState(0);
  const [rFirst, setRFirst] = useState<number | null>(null);

  // Announce each stage by moving focus to its heading.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stage]);

  function sessionExpired() {
    setStage("email");
    setToken(null);
    setBookings([]);
    setPayments([]);
    setError("For your security, you've been signed out. Ask for a new code to carry on.");
  }

  async function sendCode() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError("Enter an email address like name@example.com");
      return;
    }
    setBusy(true);
    setError(null);
    setEmailError(null);
    const { ok, data } = await post("/api/manage/start", { email });
    setBusy(false);
    if (!ok) return setEmailError(data.message ?? data.error ?? "Something went wrong. Please try again.");
    setCode("");
    setCodeError(null);
    setSentAt(Date.now());
    setStage("code");
  }

  async function loadBookings(t: string) {
    const { ok, status, data } = await post("/api/manage/bookings", { token: t });
    if (status === 401) return sessionExpired();
    if (!ok) return setError(`We couldn't load your bookings. Please try again, or call us on ${CLINIC_PHONE}.`);
    setBookings(data.bookings ?? []);
    setPayments(data.payments ?? []);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    setCodeError(null);
    const { ok, data } = await post("/api/manage/verify", { email, code: code.replace(/\D/g, "") });
    if (!ok) {
      setBusy(false);
      return setCodeError(data.message ?? data.error ?? "That code didn't work. Check it and try again.");
    }
    setToken(data.token);
    await loadBookings(data.token);
    setStage("list");
    setBusy(false);
  }

  async function cancel(b: Booking) {
    setBusy(true);
    setError(null);
    const { ok, status, data } = await post("/api/manage/cancel", { token, appointmentId: b.appointmentId });
    setBusy(false);
    setConfirmingCancel(null);
    if (status === 401) return sessionExpired();
    if (!ok) return setError(data.message ?? data.error ?? `We couldn't cancel that booking. Please call us on ${CLINIC_PHONE}.`);
    const voucherBack = data.voucherReturnedMinor > 0 ? ` ${euro(data.voucherReturnedMinor)} has gone back on your gift voucher.` : "";
    setNotice(
      data.refundedMinor > 0
        ? `Cancelled. ${euro(data.refundedMinor)} is being refunded to your card. It can take 5 to 10 working days to appear.${voucherBack} We've emailed you a confirmation.`
        : voucherBack
          ? `Cancelled.${voucherBack} We've emailed you a confirmation.`
          : data.late
          ? `Cancelled. As this was within ${CANCEL_WINDOW_HOURS} hours, the full appointment fee applies` +
            (data.lateFeeMinor > 0 ? `: ${euro(data.lateFeeMinor)} has been charged to your card on top of what you'd paid` : "") +
            ". We've emailed you a confirmation."
          : "Cancelled. We've emailed you a confirmation."
    );
    await loadBookings(token!);
  }

  /** Free times in week `i` (0 = the 7 days from today), more than 24 hours away. Throws if they can't be loaded. */
  async function weekTimes(b: Booking, i: number): Promise<string[]> {
    const w = onlineBookingWeeks(dublinDay(new Date().toISOString()))[i]; // Irish dates, not UTC
    const res = await fetch(
      `/api/available-times?businessId=${b.businessId}&practitionerId=${b.practitionerId}&appointmentTypeId=${b.appointmentTypeId}&from=${w.from}&to=${w.to}&excludeAppointmentId=${b.appointmentId}`
    );
    if (!res.ok) throw new Error(`available-times ${res.status}`);
    const d = await res.json();
    const minStart = Date.now() + CANCEL_WINDOW_HOURS * 3_600_000;
    return (d.availableTimes ?? [])
      .map((t: any) => t.appointment_start as string)
      .filter((t: string) => new Date(t).getTime() > minStart)
      .sort();
  }

  /** Opens "Change time" on the first week that has a free time, up to the online booking limit (12 weeks). */
  async function openReschedule(b: Booking) {
    setRescheduling(b.appointmentId);
    setConfirmingCancel(null);
    setNewTime(null);
    setTimes([]);
    setRWeek(0);
    setRFirst(null);
    setTimesLoading(true);
    setError(null);
    try {
      for (let i = 0; i < ONLINE_BOOKING_WEEKS_AHEAD; i++) {
        const found = await weekTimes(b, i);
        if (found.length) {
          setRWeek(i);
          setRFirst(i);
          setTimes(found);
          return;
        }
      }
    } catch {
      setError("We couldn't load available times. Please try again.");
    } finally {
      setTimesLoading(false);
    }
  }

  async function showWeek(b: Booking, i: number) {
    setRWeek(i);
    setNewTime(null);
    setTimes([]);
    setTimesLoading(true);
    setError(null);
    try {
      setTimes(await weekTimes(b, i));
    } catch {
      setError("We couldn't load available times. Please try again.");
    } finally {
      setTimesLoading(false);
    }
  }

  async function reschedule(b: Booking) {
    if (!newTime) return;
    setBusy(true);
    setError(null);
    const { ok, status, data } = await post("/api/manage/reschedule", {
      token,
      appointmentId: b.appointmentId,
      newStartsAtISO: newTime,
    });
    setBusy(false);
    if (status === 401) return sessionExpired();
    if (!ok) return setError(data.message ?? data.error ?? `We couldn't move that booking. Please call us on ${CLINIC_PHONE}.`);
    setRescheduling(null);
    setNotice(`Moved to ${whenLong(data.startsAtISO)}. Your payment carries over. We've emailed you the details.`);
    await loadBookings(token!);
  }

  const byDay = (list: string[]) => {
    const m = new Map<string, string[]>();
    for (const t of list) m.set(dublinDay(t), [...(m.get(dublinDay(t)) ?? []), t]);
    return [...m.entries()];
  };

  return (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        <div className="page-intro">
          <h1 ref={headingRef} tabIndex={-1}>
            {stage === "list" ? "Your bookings" : stage === "code" ? "Check your email" : "Manage a booking"}
          </h1>
          {stage !== "code" && <p className="lede">{POLICY_SENTENCE}</p>}
        </div>

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

        {stage === "email" && (
          <form
            noValidate
            className="stack-4"
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
          >
            <p>Enter the email you booked with and we&apos;ll send you a 6-digit code.</p>
            <div className="field">
              <label htmlFor="manage-email">Email address</label>
              {emailError && (
                <p className="field-error" id="manage-email-error">
                  <Icon name="alert" />
                  <span>
                    <span className="visually-hidden">Error: </span>
                    {emailError}
                  </span>
                </p>
              )}
              <input
                id="manage-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!emailError || undefined}
                aria-describedby={emailError ? "manage-email-error" : undefined}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send code"}
            </button>
          </form>
        )}

        {stage === "code" && (
          <div className="stack-4">
            <CodeEntry
              email={email}
              code={code}
              busy={busy}
              sentAt={sentAt}
              onChange={(c) => {
                setCode(c);
                setCodeError(null);
              }}
              onSubmit={verify}
              onResend={sendCode}
              submitLabel="Continue"
              error={codeError}
              intro={
                <>
                  We&apos;ve sent an email to <strong>{email}</strong>. If you have an upcoming appointment with us, it has a 6-digit code
                  (valid for 10 minutes). If you don&apos;t, the email will say so.
                </>
              }
            />
            <p className="secondary">No email after a couple of minutes? Check your spam or junk folder.</p>
            <button
              className="link-button"
              onClick={() => {
                setStage("email");
                setCodeError(null);
              }}
            >
              Use a different email
            </button>
            <p>
              Not booked yet? <a href="/">Book an appointment</a>
            </p>
          </div>
        )}

        {stage === "list" && bookings.length === 0 && (
          <Notice title="No upcoming appointments">
            <p>
              We couldn&apos;t find any upcoming appointments for {email}. If you think this is wrong, please call us on{" "}
              <a href={CLINIC_TEL}>{CLINIC_PHONE}</a>.
            </p>
          </Notice>
        )}

        {stage === "list" &&
          bookings.map((b) => {
            const c = cancelConsequence(b);
            return (
              <section key={b.appointmentId} className="booking-block">
                <h2>{b.appointmentTypeName}</h2>
                <dl className="summary-list is-wide">
                  {b.patientFirstName && (
                    <div className="summary-row">
                      <dt>For</dt>
                      <dd>{b.patientFirstName}</dd>
                    </div>
                  )}
                  <div className="summary-row">
                    <dt>When</dt>
                    <dd className="tnum">{whenLong(b.startsAtISO)}</dd>
                  </div>
                  {b.practitionerName && (
                    <div className="summary-row">
                      <dt>Who</dt>
                      <dd>{b.practitionerName}</dd>
                    </div>
                  )}
                  {b.paidOnline && (
                    <div className="summary-row">
                      <dt>{b.paidInFull ? "Paid in full" : "Paid"}</dt>
                      <dd className="tnum">{euro(b.paidMinor)}</dd>
                    </div>
                  )}
                </dl>

                {confirmingCancel === b.appointmentId ? (
                  <Notice
                    tone={b.freeCancellation ? "info" : "warning"}
                    title="Are you sure?"
                    actions={
                      <>
                        <button className="btn btn-destructive" disabled={busy} onClick={() => cancel(b)}>
                          {busy ? "Cancelling…" : c.button}
                        </button>
                        <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirmingCancel(null)}>
                          Keep my booking
                        </button>
                      </>
                    }
                  >
                    <p>{c.text}</p>
                  </Notice>
                ) : rescheduling === b.appointmentId ? (
                  <div className="stack-4">
                    <h3>Choose a new time{b.practitionerName ? ` with ${b.practitionerName}` : ""}</h3>
                    {timesLoading && (
                      <div className="skeleton-slots" aria-busy="true" aria-label="Checking times">
                        {Array.from({ length: 6 }, (_, i) => (
                          <div key={i} className="skeleton-row is-short" />
                        ))}
                      </div>
                    )}
                    {rFirst !== null && (() => {
                      const w = onlineBookingWeeks(dublinDay(new Date().toISOString()))[rWeek];
                      return (
                        <div className="week-nav">
                          <button className="icon-button" onClick={() => showWeek(b, rWeek - 1)} disabled={rWeek === 0 || timesLoading} aria-label="Earlier week">
                            <Icon name="chevron-left" />
                          </button>
                          <p className="week-nav-label" aria-live="polite">
                            {dayLabel(w.from).full} to {dayLabel(w.to).full}
                          </p>
                          <button
                            className="icon-button"
                            onClick={() => showWeek(b, rWeek + 1)}
                            disabled={rWeek >= ONLINE_BOOKING_WEEKS_AHEAD - 1 || timesLoading}
                            aria-label="Later week"
                          >
                            <Icon name="chevron-right" />
                          </button>
                        </div>
                      );
                    })()}
                    {!timesLoading && rFirst === null && (
                      <Notice title={`No online times${b.practitionerName ? ` with ${b.practitionerName}` : ""} in the next ${ONLINE_BOOKING_WEEKS_AHEAD} weeks`}>
                        <p>
                          Please call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a> and we&apos;ll find you a time.
                        </p>
                      </Notice>
                    )}
                    {!timesLoading && rFirst !== null && times.length === 0 && (
                      <Notice
                        title="No times this week"
                        actions={
                          rWeek < ONLINE_BOOKING_WEEKS_AHEAD - 1 ? (
                            <button className="btn btn-secondary" onClick={() => showWeek(b, rWeek + 1)}>
                              Show next week
                            </button>
                          ) : undefined
                        }
                      >
                        <p>
                          Try another week, or call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a>.
                        </p>
                      </Notice>
                    )}
                    {!timesLoading && rFirst !== null && rWeek === rFirst && rFirst > 0 && times.length > 0 && (
                      <p className="secondary">The first free time{b.practitionerName ? ` with ${b.practitionerName}` : ""} is {dayShort(times[0])}.</p>
                    )}
                    {byDay(times).map(([day, list]) => (
                      <div className="slot-group" key={day}>
                        <h3>{dayLong(list[0])}</h3>
                        <ul className="slot-grid">
                          {list.map((t) => (
                            <li key={t}>
                              <button className="slot" aria-pressed={newTime === t} onClick={() => setNewTime(t)}>
                                {timeShort(t)}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <div className="actions">
                      <button className="btn btn-primary" disabled={busy || !newTime} onClick={() => reschedule(b)}>
                        {busy ? "Moving…" : newTime ? `Move to ${whenLong(newTime)}` : "Choose a time"}
                      </button>
                      <button className="btn btn-secondary" disabled={busy} onClick={() => setRescheduling(null)}>
                        Back
                      </button>
                    </div>
                  </div>
                ) : b.freeCancellation ? (
                  <div className="actions">
                    {b.canReschedule && (
                      <button className="btn btn-primary" onClick={() => openReschedule(b)}>
                        Change time
                      </button>
                    )}
                    {b.canCancelOnline && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          setConfirmingCancel(b.appointmentId);
                          setRescheduling(null);
                        }}
                      >
                        Cancel booking
                      </button>
                    )}
                  </div>
                ) : (
                  <Notice
                    tone="warning"
                    title={`Inside ${CANCEL_WINDOW_HOURS} hours, a fee applies`}
                    actions={
                      <>
                        <a className="btn btn-secondary" href={CLINIC_TEL}>
                          <Icon name="phone" /> Call reception
                        </a>
                        {b.canCancelOnline && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => {
                              setConfirmingCancel(b.appointmentId);
                              setRescheduling(null);
                            }}
                          >
                            Cancel booking
                          </button>
                        )}
                      </>
                    }
                  >
                    <p>
                      Your appointment is less than {CANCEL_WINDOW_HOURS} hours away. Cancelling now means the full appointment fee
                      {b.fullPriceMinor ? ` of ${euro(b.fullPriceMinor)}` : ""} is charged. To change the time, please call reception on {CLINIC_PHONE}.
                    </p>
                  </Notice>
                )}
              </section>
            );
          })}

        {stage === "list" && (
          <section className="booking-block" aria-labelledby="past-payments">
            <h2 id="past-payments">Past payments</h2>
            {payments.length === 0 ? (
              <p className="secondary">No payments yet. Anything you pay online, or on the day for an extra treatment, is listed here.</p>
            ) : (
              <>
                <p className="secondary">Everything you&apos;ve paid us, newest first. Refunds can take 5 to 10 working days to reach your card.</p>
                <ul className="payment-list">
                  {payments.map((p) => (
                    <li key={p.id} className="payment-row">
                      <div className="payment-main">
                        <p className="payment-what">
                          {p.what} <span className="secondary">· {p.treatment}</span>
                        </p>
                        <p className="secondary">
                          {p.practitionerName ? `${p.practitionerName}, ` : ""}
                          appointment {dayShort(p.appointmentAtISO)}
                          {p.cancelled ? " (cancelled)" : ""}
                        </p>
                        <p className="secondary">
                          Paid {dayShort(p.paidAtISO)} · {p.method}
                        </p>
                      </div>
                      <div className="payment-amount">
                        <p className="tnum">{euro(p.amountMinor)}</p>
                        {p.refundedMinor > 0 && (
                          <span className="badge is-good">{p.refundedMinor >= p.amountMinor ? "Refunded" : `${euro(p.refundedMinor)} refunded`}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </main>
    </>
  );
}
