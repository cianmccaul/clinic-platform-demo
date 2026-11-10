"use client";

import { useEffect, useState } from "react";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { TimePicker } from "@/components/TimePicker";
import { CLINIC_PHONE, CLINIC_TEL, euro } from "@/core/policy";
import { dayLong, whenLong } from "@/core/format";

/**
 * "You've already paid: pick another time". Emailed when the time a patient
 * paid for was taken a moment before the payment went through (lib/rebook.ts).
 * They pick a new time with the same therapist (no new payment), or ask for
 * the refund.
 */
type Rebook = {
  status: "open" | "booked" | "refunded";
  firstName: string;
  appointmentTypeName: string;
  practitionerName: string;
  amountMinor: number;
  originalStartsAtISO: string;
  refundBy: string;
  bookedStartsAtISO: string | null;
  businessId: string;
  practitionerId: string;
  appointmentTypeId: string;
};

export default function RebookPage({ params }: { params: { token: string } }) {
  const [r, setR] = useState<Rebook | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);

  useEffect(() => {
    fetch(`/api/rebook/${encodeURIComponent(params.token)}`, { cache: "no-store" })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (res.status === 404) setLoadError("not_found");
        else if (!res.ok) setLoadError("error");
        else setR(d);
      })
      .catch(() => setLoadError("error"));
  }, [params.token]);

  async function send(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rebook/${encodeURIComponent(params.token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `Something went wrong. Please call us on ${CLINIC_PHONE}.`);
        if (d.code === "slot_taken") {
          setTime(null);
          setPickerKey((k) => k + 1); // reload the times
        }
        return;
      }
      setR((cur) => (cur ? { ...cur, status: d.status, bookedStartsAtISO: d.bookedStartsAtISO } : cur));
    } catch {
      setError(`We couldn't reach the clinic's system. Please try again, or call us on ${CLINIC_PHONE}.`);
    } finally {
      setBusy(false);
    }
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
      <Notice tone="error" title={loadError === "not_found" ? "This link isn't valid" : "We couldn't load this page"} actions={call}>
        <p>Please call us and we&apos;ll sort it out.</p>
      </Notice>
    );
  }
  if (!r) return shell(<p className="secondary">Loading…</p>);

  if (r.status === "booked" && r.bookedStartsAtISO) {
    return shell(
      <div className="stack-5">
        <h1>You&apos;re booked in</h1>
        <Notice tone="success" title={whenLong(r.bookedStartsAtISO)} actions={<a className="btn btn-secondary" href="/manage">Manage booking</a>}>
          <p>
            Your {r.appointmentTypeName} with {r.practitionerName} is booked on the payment you already made. You&apos;ll get a confirmation email shortly.
          </p>
        </Notice>
      </div>
    );
  }
  if (r.status === "refunded") {
    return shell(
      <div className="stack-5">
        <h1>Refunded</h1>
        <Notice tone="info" title={`${euro(r.amountMinor)} refunded in full`} actions={<a className="btn btn-secondary" href="/">Book again</a>}>
          <p>It can take 5 to 10 working days to show on your statement.</p>
        </Notice>
      </div>
    );
  }

  return shell(
    <div className="stack-5">
      <div className="page-intro">
        <h1>Pick another time</h1>
        <p>
          Sorry, {r.firstName}: {whenLong(r.originalStartsAtISO)} was booked by someone else just before your payment went through.{" "}
          <strong>You don&apos;t need to pay again.</strong> Your {euro(r.amountMinor)} is kept for you: choose a new time for your {r.appointmentTypeName} with{" "}
          {r.practitionerName} and it&apos;s booked straight away.
        </p>
      </div>
      {error && (
        <Notice tone="error" title="That didn't work">
          <p>{error}</p>
        </Notice>
      )}
      <TimePicker
        key={pickerKey}
        businessId={r.businessId}
        practitionerId={r.practitionerId}
        appointmentTypeId={r.appointmentTypeId}
        value={time}
        onChange={setTime}
        emptyText={`Please call us on ${CLINIC_PHONE} and we'll find you a time.`}
      />
      <div className="actions">
        <button className="btn btn-primary" disabled={busy || !time} onClick={() => send({ action: "book", startsAtISO: time })}>
          {busy && !confirmRefund ? "Booking…" : time ? `Book ${whenLong(time)}` : "Choose a time"}
        </button>
      </div>
      <hr />
      {confirmRefund ? (
        <Notice
          tone="warning"
          title={`Refund ${euro(r.amountMinor)} instead?`}
          actions={
            <>
              <button className="btn btn-primary" disabled={busy} onClick={() => send({ action: "refund" })}>
                {busy ? "Refunding…" : "Yes, refund me"}
              </button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirmRefund(false)}>
                Back
              </button>
            </>
          }
        >
          <p>No appointment will be booked. The refund can take 5 to 10 working days to show on your statement.</p>
        </Notice>
      ) : (
        <p className="secondary">
          Rather have your money back?{" "}
          <button className="link-button" onClick={() => setConfirmRefund(true)}>
            Refund me instead
          </button>
          . If no new time is chosen by {dayLong(r.refundBy)}, we&apos;ll refund you automatically.
        </p>
      )}
      <p className="secondary">
        Or call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a> and we&apos;ll book it for you.
      </p>
    </div>
  );
}
