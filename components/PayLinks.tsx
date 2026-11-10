"use client";

import { useEffect, useState } from "react";
import { euro, formatDublin } from "@/core/policy";
import { timeShort } from "@/core/format";
import { Notice } from "@/components/Brand";

/**
 * Payment links sent after phone bookings: who, for what, and whether
 * they've paid. Reception can cancel one (the time is freed). Paid links
 * become normal bookings in the list below. Saved-card payments waiting for
 * the patient to approve with their bank are listed too (lib/approvals.ts).
 */
type ApprovalRow = {
  id: string;
  status: "waiting" | "failed" | "paid" | "expired" | "cancelled" | "booking_failed";
  createdAt: string;
  expiresAt: string;
  patientName: string;
  appointmentTypeName: string;
  practitionerName: string;
  startsAtISO: string;
  amountMinor: number;
  last4: string | null;
  message: string | null;
};

const APPROVAL_STATUS: Record<ApprovalRow["status"], { label: string; cls: string }> = {
  waiting: { label: "Waiting for the patient to approve", cls: "is-warn" },
  failed: { label: "They couldn't approve it", cls: "is-bad" },
  paid: { label: "Approved, paid and booked", cls: "is-good" },
  expired: { label: "Approval expired, time freed", cls: "is-bad" },
  cancelled: { label: "Cancelled: payment link sent instead", cls: "" },
  booking_failed: { label: "Approved, but not booked: check it", cls: "is-bad" },
};
type Link = {
  id: string;
  status: "pending" | "paid" | "cancelled" | "expired" | "refunded" | "rebook";
  createdAt: string;
  expiresAt: string;
  channel: "email" | "sms";
  patientName: string;
  patientEmail: string;
  appointmentTypeName: string;
  practitionerName: string;
  startsAtISO: string;
  amountMinor: number;
  appointmentId: string | null;
};

const STATUS: Record<Link["status"], { label: string; cls: string }> = {
  pending: { label: "Waiting for payment", cls: "is-warn" },
  paid: { label: "Paid and booked", cls: "is-good" },
  expired: { label: "Expired, time freed", cls: "is-bad" },
  cancelled: { label: "Cancelled", cls: "" },
  refunded: { label: "Paid, but the time was gone: refunded", cls: "is-bad" },
  rebook: { label: "Paid, but the time was gone: picking another time", cls: "is-warn" },
};

export default function PayLinks({ adminKey }: { adminKey: string }) {
  // No key = signed in to the dashboard: the session cookie is sent instead.
  const auth: Record<string, string> = adminKey ? { Authorization: `Bearer ${adminKey}` } : {};
  const [links, setLinks] = useState<Link[] | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/pay-links", { headers: auth });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setLinks(data.links);
      setApprovals(data.approvals ?? []);
    }
    else setError(data.error ?? "Couldn't load payment links.");
  }
  useEffect(() => {
    load().catch(() => setError("Couldn't load payment links."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);

  async function cancel(l: Link) {
    if (!window.confirm(`Cancel the payment link for ${l.patientName}? The link stops working and the time is freed.`)) return;
    setBusy(l.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/pay-links", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ id: l.id, action: "cancel" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Couldn't cancel it.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel block-gap">
      <h2 className="panel-title">Phone bookings waiting for payment</h2>
      <div className="row-actions">
        <a className="btn btn-primary" href={adminKey ? "/admin/book" : "/dashboard/book"}>
          Book a patient by phone
        </a>
        <button className="btn btn-secondary" onClick={() => load()} disabled={!!busy}>
          Refresh
        </button>
      </div>
      {error && (
        <div className="row-actions">
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        </div>
      )}
      {approvals.length > 0 && (
        <div className="log">
          {approvals.map((a) => (
            <div key={a.id} className="panel-meta">
              <span className={`badge ${APPROVAL_STATUS[a.status].cls}`}>{APPROVAL_STATUS[a.status].label}</span>{" "}
              <strong>{a.patientName}</strong> — {a.appointmentTypeName} with {a.practitionerName}, {formatDublin(a.startsAtISO)} · {euro(a.amountMinor)} ·
              saved card{a.last4 ? ` ending ${a.last4}` : ""}, approval emailed {timeShort(a.createdAt)}
              {a.status === "waiting" || a.status === "failed" ? ` · held until ${timeShort(a.expiresAt)}` : ""}
              {a.status === "booking_failed" && a.message ? ` · ${a.message}` : ""}
            </div>
          ))}
        </div>
      )}
      {links && links.length === 0 && approvals.length === 0 && <p className="secondary block-gap">No payment links in the last day.</p>}
      {links && links.length > 0 && (
        <div className="log">
          {links.map((l) => (
            <div key={l.id} className="panel-meta">
              <span className={`badge ${STATUS[l.status].cls}`}>{STATUS[l.status].label}</span>{" "}
              <strong>{l.patientName}</strong> — {l.appointmentTypeName} with {l.practitionerName}, {formatDublin(l.startsAtISO)} · {euro(l.amountMinor)} ·
              sent by {l.channel === "sms" ? "text" : "email"} {timeShort(l.createdAt)}
              {l.status === "pending" ? ` · held until ${timeShort(l.expiresAt)}` : ""}
              {l.status === "pending" && (
                <>
                  {" "}
                  <button className="link-button" disabled={!!busy} onClick={() => cancel(l)}>
                    Cancel link
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
