"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { CLINIC_PHONE, CLINIC_TEL } from "@/core/policy";
import { dayShort } from "@/core/format";

/** A patient's own place on the waitlist: leave it, or pause it for a while. Reached from the link in their texts or emails, or from an offer's pay page. */
type Entry = { status: string; firstName: string; treatment: string; practitioner: string | null; days: number[]; parts: string[]; untilDay: string; hasOffer: boolean };
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function WaitlistLeavePage({ params }: { params: { token: string } }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [problem, setProblem] = useState<"not_found" | "error" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [said, setSaid] = useState(""); // read out after a change (audit M11)
  const headingRef = useRef<HTMLHeadingElement>(null);

  const url = `/api/waitlist/${encodeURIComponent(params.token)}`;
  useEffect(() => {
    document.title = "Your waitlist place · Northbank";
    fetch(url, { cache: "no-store" })
      .then(async (r) => (r.status === 404 ? setProblem("not_found") : r.ok ? setEntry(await r.json()) : setProblem("error")))
      .catch(() => setProblem("error"));
  }, [url]);

  async function act(action: "leave" | "pause" | "resume") {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "failed");
      setEntry((e) => (e ? { ...e, status: d.status ?? e.status } : e));
      setConfirmLeave(false);
      setSaid(action === "leave" ? "You've left the waitlist." : action === "pause" ? "Your place is paused. We won't offer you anything until you start it again." : "We're watching for a time again.");
      // The button pressed has gone: start again from the top of the page.
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setError(`That didn't work. Please try again, or call us on ${CLINIC_PHONE}.`);
    }
    setBusy(false);
  }

  const shell = (body: React.ReactNode) => (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        {body}
      </main>
    </>
  );
  const call = (
    <a className="btn btn-secondary" href={CLINIC_TEL}>
      <Icon name="phone" /> Call {CLINIC_PHONE}
    </a>
  );

  if (problem) {
    return shell(
      <Notice tone="error" title={problem === "not_found" ? "This link isn't valid any more" : "We couldn't load your waitlist place"} actions={call}>
        <p>{problem === "not_found" ? "Your place on the waitlist may already have ended. If you think that's wrong, please call us." : "Please try again in a minute."}</p>
      </Notice>
    );
  }
  if (!entry) return shell(<p className="secondary">Loading…</p>);

  const ended = ["cancelled", "filled", "expired"].includes(entry.status);
  const when = [
    entry.days.length ? entry.days.map((d) => DAY[d]).join(", ") : "any day",
    entry.parts.length ? entry.parts.map((p) => p.toLowerCase()).join(" or ") : "any time of day",
  ].join(", ");

  return shell(
    <div className="stack-5">
      <div className="page-intro">
        <h1 ref={headingRef} tabIndex={-1}>Your waitlist place</h1>
        <p className="lede">
          {entry.treatment} with {entry.practitioner ?? "any of our therapists"}.
        </p>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">{said}</p>
      {ended ? (
        <Notice tone={entry.status === "filled" ? "success" : "info"} title={entry.status === "filled" ? "You booked a time, so you're off the waitlist" : entry.status === "cancelled" ? "You've left the waitlist" : "This waitlist place has ended"} actions={<a className="btn btn-secondary" href="/">Back to booking</a>}>
          <p>We won&apos;t send you any more offers for this.</p>
        </Notice>
      ) : (
        <>
          <dl className="summary-list is-wide">
            <div className="summary-row"><dt>Days</dt><dd>{when}</dd></div>
            <div className="summary-row"><dt>Until</dt><dd>{dayShort(`${entry.untilDay}T12:00:00Z`)}</dd></div>
            <div className="summary-row"><dt>Status</dt><dd>{entry.status === "paused" ? "Paused: we won't offer you anything" : entry.hasOffer ? "A time has been offered to you: check your texts or email" : "Active: we're watching for a time"}</dd></div>
          </dl>
          {error && <Notice tone="error" title="Something went wrong"><p>{error}</p></Notice>}
          <div className="stack-3">
            {entry.status === "paused" ? (
              <button className="btn btn-primary btn-block" disabled={busy} onClick={() => act("resume")}>Start offering me times again</button>
            ) : entry.status === "active" ? (
              <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => act("pause")}>Pause for now</button>
            ) : null}
            {confirmLeave ? (
              // One tap could lose someone their place by mistake, so leaving asks once more (audit L8).
              <div className="notice is-warning" role="group" aria-labelledby="leave-q">
                <Icon name="alert" />
                <div className="notice-body stack-3">
                  <p className="notice-title" id="leave-q" tabIndex={-1}>Leave the waitlist?</p>
                  <p>You&apos;ll lose your place. To stop offers for a while instead, choose Pause for now.</p>
                  <button className="btn btn-primary btn-block" disabled={busy} onClick={() => act("leave")}>Yes, leave the waitlist</button>
                  <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => setConfirmLeave(false)}>No, keep my place</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => { setConfirmLeave(true); requestAnimationFrame(() => document.getElementById("leave-q")?.focus()); }}>Leave the waitlist</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
