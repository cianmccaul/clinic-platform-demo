"use client";

import { useCallback, useEffect, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { euro, formatDublin } from "@/core/policy";

/**
 * Not invoiced yet (core/invoicing.ts): paid online and phone bookings with
 * no Cliniko invoice. Reception makes the invoice in Cliniko and presses
 * Send; the booking then drops off this list by itself.
 */
export default function UninvoicedPage() {
  return (
    <StaffGate permission="bookings:view" title="Not invoiced yet">
      {() => <Uninvoiced />}
    </StaffGate>
  );
}

type Row = {
  appointmentId: string;
  patientName: string;
  patientEmail: string;
  appointmentTypeName: string;
  practitionerName: string;
  startsAtISO: string;
  status: "booked" | "cancelled";
  lateCancellation: boolean;
  netPaidMinor: number;
  clinikoUrl: string;
};
type Data = { from: string; to: string; today: string; unchecked: number; bookings: Row[]; hubInvoicesFrom?: string | null };

function Uninvoiced() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/uninvoiced", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't load the list.");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <DashboardShell
      title="Not invoiced yet"
      lede="Bookings paid online or by payment link that have no invoice in Cliniko yet. Make the invoice in Cliniko and send it: the booking then drops off this list by itself."
    >
      <div className="stack-5">
        {data?.hubInvoicesFrom && (
          <Notice title="The Hub sends invoices itself now">
            <p>
              Payments from {formatDay(data.hubInvoicesFrom)} get a Hub invoice automatically (see <a href="/dashboard/invoices">Invoices</a>). This list only shows money from older payments that still needs a Cliniko invoice.
            </p>
          </Notice>
        )}
        <Notice title="For each booking">
          <ol>
            <li>
              Press <strong>Open in Cliniko</strong>, then open the appointment and press <strong>Add a payment</strong>.
            </li>
            <li>
              Check the invoice item and price, then press <strong>Save invoice</strong>.
            </li>
            <li>
              Record the amount below as <strong>Credit Card</strong> and press <strong>Save payment</strong>. Never <strong>Stripe (online)</strong>.
            </li>
            <li>
              On the invoice, press <strong>Send...</strong> to email it to the patient.
            </li>
          </ol>
        </Notice>

        <div className="row-actions">
          <button className="btn btn-secondary" disabled={loading} onClick={load}>
            {loading ? "Checking Cliniko…" : "Check again"}
          </button>
        </div>

        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {data && data.unchecked > 0 && (
          <Notice tone="warning">
            <p>
              Cliniko didn&apos;t answer for {data.unchecked} booking{data.unchecked === 1 ? "" : "s"}, so they&apos;re shown to be safe. Check Cliniko before
              invoicing them, or press Check again.
            </p>
          </Notice>
        )}
        {data && !loading && data.bookings.length === 0 && !error && <p className="secondary">Everything is invoiced. Nothing to do.</p>}

        {data?.bookings.map((r) => (
          <section key={r.appointmentId} className="panel">
            <h2 className="panel-title">{r.patientName || r.patientEmail}</h2>
            <p className="panel-meta">
              {r.appointmentTypeName} with {r.practitionerName} — {formatDublin(r.startsAtISO)}
            </p>
            <div className="badge-row">
              <span className="badge">Paid {euro(r.netPaidMinor)}</span>
              {r.startsAtISO.slice(0, 10) > data.today && <span className="badge">Upcoming</span>}
              {r.status === "cancelled" && <span className="badge is-warn">Cancelled{r.lateCancellation ? ", fee kept" : ""}</span>}
            </div>
            <div className="row-actions">
              <a className="btn btn-secondary" href={r.clinikoUrl} target="_blank" rel="noopener noreferrer">
                Open in Cliniko
              </a>
            </div>
          </section>
        ))}

        {data && (
          <p className="secondary">
            Showing appointments from {formatDay(data.from)} to {formatDay(data.to)}.
          </p>
        )}
      </div>
    </DashboardShell>
  );
}

const formatDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "long", year: "numeric" });
