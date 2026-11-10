"use client";

import { useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import type { H1Report, H1Row } from "@/lib/h1-backfill";

/**
 * Owners only, one-off (audit H1, 28 Oct 2026): saved-card bookings made
 * before the fix don't say which therapist's Stripe account they were paid
 * to. Check first (nothing changes), then fix them all at once
 * (/api/admin/h1-backfill). Reached by its address, not a dashboard tile.
 */

const RESULT: Record<H1Row["result"], string> = {
  found: "Found on the therapist's account",
  clinic: "On Northbank's own account (older charge): left as it is",
  unsure: "Couldn't check: run again",
  error: "Error: run again",
};

export default function FixRefundAccountsPage() {
  const [report, setReport] = useState<H1Report | null>(null);
  const [busy, setBusy] = useState<"check" | "fix" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(apply: boolean) {
    if (apply && !window.confirm("Fix these bookings now? Each one is written to the audit log. Payments and refunds aren't touched.")) return;
    setBusy(apply ? "fix" : "check");
    setError(null);
    try {
      const res = await fetch("/api/admin/h1-backfill", apply ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply: true }) } : { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.rows)) setError(data.error ?? "Something went wrong. Nothing was changed.");
      else setReport(data);
    } catch {
      setError("Couldn't reach the Hub. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const found = report?.rows.filter((r) => r.result === "found").length ?? 0;
  const again = report?.rows.filter((r) => r.result === "unsure" || r.result === "error").length ?? 0;

  return (
    <StaffGate permission="therapists:payments-setup" title="Fix older saved-card bookings">
      {() => (
        <DashboardShell
          title="Fix older saved-card bookings"
          narrow
          lede="Saved-card bookings made before 28 Oct don't record which therapist's Stripe account they were paid to, so refunding them depends on finding it at the time. This finds it for all of them now."
        >
          <div className="stack-4">
            <p>
              <strong>Check</strong> asks Stripe and changes nothing. <strong>Fix them</strong> saves what was found. Payments and refunds aren&apos;t touched,
              and it&apos;s safe to run again.
            </p>
            <p>
              <button className="btn btn-secondary" disabled={!!busy} onClick={() => run(false)}>
                {busy === "check" ? "Checking…" : "Check"}
              </button>{" "}
              {report && !report.applied && found + again > 0 && (
                <button className="btn btn-primary" disabled={!!busy} onClick={() => run(true)}>
                  {busy === "fix" ? "Fixing…" : `Fix them (${found + again})`}
                </button>
              )}
            </p>
            {error && (
              <Notice tone="error">
                <p>{error}</p>
              </Notice>
            )}
            {report && (
              <Notice tone={again ? "warning" : "success"} title={report.applied ? "Done" : "Checked: nothing changed yet"}>
                <p>
                  {report.bookingsChecked} bookings looked at ({report.from} to {report.to}). {report.rows.length ? `${report.rows.length} payment${report.rows.length === 1 ? "" : "s"} without an account: ${found} found on a therapist's account${again ? `, ${again} to run again` : ""}.` : "None need fixing."}
                </p>
              </Notice>
            )}
            {report && report.rows.length > 0 && (
              <table className="guide-table">
                <thead>
                  <tr>
                    <th scope="col">Appointment</th>
                    <th scope="col">Day</th>
                    <th scope="col">Payment</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.paymentIntentId}>
                      <td>{r.appointmentId}</td>
                      <td>{r.day}</td>
                      <td>{r.paymentIntentId}</td>
                      <td>
                        {RESULT[r.result]}
                        {r.account ? ` (${r.account})` : ""}
                        {r.error ? `: ${r.error}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DashboardShell>
      )}
    </StaffGate>
  );
}
