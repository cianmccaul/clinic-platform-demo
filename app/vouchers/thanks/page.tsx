"use client";

import { useEffect, useState } from "react";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { CLINIC_PHONE, CLINIC_TEL } from "@/core/policy";
import { euroText } from "@/core/hub-invoice";

/**
 * After paying for a gift voucher on Stripe. The voucher is issued by the
 * webhook a few seconds later, so this asks /api/vouchers/status until it
 * knows, instead of assuming.
 */
type Status =
  | { state: "checking" | "processing" | "unpaid" | "unknown" | "not_found" | "no_session" | "slow" }
  | { state: "issued"; amountMinor: number; sentTo: string[]; emailed: boolean; forThem: boolean; sendOn?: string | null };

export default function VoucherThanks() {
  const [status, setStatus] = useState<Status>({ state: "checking" });

  useEffect(() => {
    document.title = "Thank you · Northbank gift vouchers";
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) {
      setStatus({ state: "no_session" });
      return;
    }
    let tries = 0;
    let stop = false;
    const ask = async () => {
      tries++;
      try {
        const res = await fetch(`/api/vouchers/status?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        const d = await res.json();
        if (stop) return;
        if (d.state === "issued" || d.state === "unpaid" || d.state === "not_found") return setStatus(d);
        if (tries >= 15) return setStatus({ state: "slow" });
        setStatus({ state: "processing" });
      } catch {
        if (tries >= 15) return setStatus({ state: "slow" });
      }
      setTimeout(ask, 2000);
    };
    ask();
    return () => {
      stop = true;
    };
  }, []);

  const call = (
    <a className="btn btn-secondary" href={CLINIC_TEL}>
      <Icon name="phone" /> Call {CLINIC_PHONE}
    </a>
  );

  let body: React.ReactNode;
  if (status.state === "issued") {
    body = (
      <div className="stack-5">
        <div className="page-intro">
          <h1>Thank you</h1>
          <p className="lede">
            Your {euroText(status.amountMinor)} Northbank gift voucher is ready.{" "}
            {status.emailed
              ? status.sendOn
                ? `We've emailed your copy to ${status.sentTo[status.sentTo.length - 1]}. We'll email it to ${status.sentTo[0]} on ${new Date(`${status.sendOn}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" })}, in the morning.`
                : `We've emailed it to ${status.sentTo.join(" and ")}${status.forThem ? " (your copy goes to you)" : ""}.`
              : "It's on its way by email."}
          </p>
        </div>
        <Notice tone="success" title="What happens next">
          <p>The email has the voucher code and a PDF to print. If it isn&apos;t there in a few minutes, check the spam folder, or call us and we&apos;ll send it again.</p>
        </Notice>
        <a className="btn btn-secondary" href="/">
          Book an appointment
        </a>
      </div>
    );
  } else if (status.state === "unpaid") {
    body = (
      <Notice tone="warning" title="The payment didn't go through" actions={<a className="btn btn-secondary" href="/vouchers">Try again</a>}>
        <p>Nothing has been charged.</p>
      </Notice>
    );
  } else if (status.state === "slow" || status.state === "unknown") {
    body = (
      <Notice tone="warning" title="Your payment went through, the email is taking longer than usual" actions={call}>
        <p>The voucher will reach you by email. If it hasn&apos;t arrived within an hour, call us and we&apos;ll send it again.</p>
      </Notice>
    );
  } else if (status.state === "not_found" || status.state === "no_session") {
    body = (
      <Notice title="Nothing to show here" actions={<a className="btn btn-secondary" href="/vouchers">Buy a gift voucher</a>}>
        <p>If you&apos;ve just bought a voucher, it will reach you by email.</p>
      </Notice>
    );
  } else {
    body = (
      <div className="stack-5" role="status">
        <h1>Payment received</h1>
        <p className="lede">Getting your voucher ready…</p>
      </div>
    );
  }

  return (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        {body}
      </main>
    </>
  );
}
