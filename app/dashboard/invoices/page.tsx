"use client";

import { useCallback, useEffect, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { euroText } from "@/core/hub-invoice";

/**
 * Hub invoices (lib/hub-invoices.ts): every invoice and credit note the Hub has
 * sent for payments it took, whether each was emailed and saved to Cliniko,
 * with Resend / Save to Cliniko again. Reception and up.
 */
export default function InvoicesPage() {
  return (
    <StaffGate permission="bookings:view" title="Invoices">
      {() => <Invoices />}
    </StaffGate>
  );
}

type Row = {
  number: string;
  kind: "invoice" | "credit_note";
  issuedAt: string;
  patientName: string;
  patientEmail: string | null;
  practitionerName: string;
  description: string;
  totalMinor: number;
  originalNumber: string | null;
  creditedMinor: number;
  emailedAt: string | null;
  emailError: string | null;
  clinikoUploadedAt: string | null;
  clinikoError: string | null;
};
type Data = { from: string; to: string; on: boolean; startsAt: string | null; waiting: number; missingRefs: string[] | null; invoices: Row[] };

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });
const todayDublin = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const daysBack = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

function Invoices() {
  const [from, setFrom] = useState(() => daysBack(todayDublin(), 30));
  const [to, setTo] = useState(() => todayDublin());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // The result of Email again / Save to Cliniko, shown in that invoice's own card (audit M11).
  const [rowResult, setRowResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/invoices?from=${f}&to=${t}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't load the invoices.");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const act = async (action: "resend" | "cliniko", r: Row) => {
    setBusy(`${action}:${r.number}`);
    setRowResult((m) => ({ ...m, [r.number]: { ok: true, text: "" } }));
    let result: { ok: boolean; text: string };
    try {
      const res = await fetch("/api/admin/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, number: r.number }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "That didn't work. Try again.");
      result = { ok: true, text: action === "resend" ? `Emailed to ${r.patientEmail}.` : `Saved to ${r.patientName}'s Files in Cliniko.` };
      await load(from, to);
    } catch (e: any) {
      result = { ok: false, text: e.message };
    }
    setRowResult((m) => ({ ...m, [r.number]: result }));
    setBusy(null);
    // The pressed button may be gone now (Save to Cliniko) or was disabled: put focus on this card's heading.
    requestAnimationFrame(() => document.getElementById(`inv-${r.number}`)?.focus());
  };

  return (
    <DashboardShell
      title="Invoices"
      lede="Invoices and credit notes the Hub sends for payments it takes: online bookings, payment links, the waitlist, and fees. Each is emailed to the patient as a PDF and saved in their Files in Cliniko. Payments taken in the clinic are still invoiced in Cliniko."
    >
      <div className="stack-5">
        {data && !data.on && (
          <Notice title="Hub invoices aren't switched on yet">
            <p>
              Until they are, keep invoicing online and payment-link bookings in Cliniko from <a href="/dashboard/uninvoiced">Not invoiced yet</a>. To switch them on, set HUB_INVOICES_START in Vercel to the first day (for example 2026-11-02) and redeploy. Payments from that
              day get a Hub invoice; earlier ones stay with Cliniko.
            </p>
          </Notice>
        )}
        {data?.on && data.startsAt && (
          <p className="secondary">
            On for payments from {fmtDay(data.startsAt.slice(0, 10))}. {data.waiting ? `${data.waiting} booking${data.waiting === 1 ? "" : "s"} being brought up to date (every 5 minutes).` : "Everything is up to date."}
          </p>
        )}
        {data?.missingRefs && data.missingRefs.length > 0 && (
          <Notice tone="warning" title="Reference numbers missing in Cliniko">
            <p>
              These therapists have no registration or insurer numbers in Cliniko, so their invoices will say &quot;Registration number on request&quot;, and patients may not be able to claim: {data.missingRefs.join(", ")}. Add them in Cliniko under each
              practitioner&apos;s reference numbers.
            </p>
          </Notice>
        )}

        <div className="actions">
          <a className="btn btn-secondary" href="/api/admin/invoices/pdf?sample=receipt" target="_blank" rel="noopener noreferrer">
            See a sample invoice<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          <a className="btn btn-secondary" href="/api/admin/invoices/pdf?sample=credit_note" target="_blank" rel="noopener noreferrer">
            See a sample credit note<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </div>

        <form
          className="field-row"
          onSubmit={(e) => {
            e.preventDefault();
            load(from, to);
          }}
        >
          <div className="field">
            <label htmlFor="inv-from">From</label>
            <input id="inv-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="inv-to">To</label>
            <input id="inv-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field">
            <button className="btn btn-secondary" disabled={loading} type="submit">
              {loading ? "Loading…" : "Show"}
            </button>
          </div>
        </form>

        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}

        {data && !loading && data.invoices.length === 0 && !error && <p className="secondary">No Hub invoices issued between {fmtDay(data.from)} and {fmtDay(data.to)}.</p>}

        {data?.invoices.map((r) => (
          <section key={r.number} className="panel" aria-labelledby={`inv-${r.number}`}>
            <h2 className="panel-title" id={`inv-${r.number}`} tabIndex={-1}>
              {r.kind === "credit_note" ? "Credit note" : "Invoice"} {r.number}
            </h2>
            <p className="panel-meta">
              {r.patientName} · {r.description} · {r.practitionerName} · issued {fmtWhen(r.issuedAt)}
            </p>
            <div className="badge-row">
              <span className="badge">{euroText(r.totalMinor)}</span>
              {r.originalNumber && <span className="badge">Reverses {r.originalNumber}</span>}
              {r.kind === "invoice" && r.creditedMinor > 0 && <span className="badge is-warn">{euroText(r.creditedMinor)} refunded</span>}
              <span className={r.emailedAt ? "badge" : "badge is-warn"}>{r.emailedAt ? `Emailed ${fmtWhen(r.emailedAt)}` : "Not emailed yet"}</span>
              <span className={r.clinikoUploadedAt ? "badge" : "badge is-warn"}>{r.clinikoUploadedAt ? "In Cliniko Files" : "Not in Cliniko yet"}</span>
            </div>
            {(r.emailError || r.clinikoError) && (
              <p className="secondary">
                {r.emailError ? `Email: ${r.emailError}. ` : ""}
                {r.clinikoError ? `Cliniko: ${r.clinikoError}.` : ""}
              </p>
            )}
            {/* Always there, so screen readers announce the result when it's filled in. */}
            <p className={rowResult[r.number]?.ok === false ? "field-error" : "secondary"} role="status" aria-live="polite">
              {rowResult[r.number]?.text ?? ""}
            </p>
            <div className="row-actions">
              <a className="btn btn-secondary" href={`/api/admin/invoices/pdf?number=${encodeURIComponent(r.number)}`} target="_blank" rel="noopener noreferrer">
                Open PDF<span className="visually-hidden"> (opens in a new tab)</span>
              </a>
              {r.patientEmail && (
                <button className="btn btn-secondary" disabled={!!busy} onClick={() => act("resend", r)}>
                  {busy === `resend:${r.number}` ? "Emailing…" : r.emailedAt ? "Email again" : "Email now"}
                </button>
              )}
              {!r.clinikoUploadedAt && (
                <button className="btn btn-secondary" disabled={!!busy} onClick={() => act("cliniko", r)}>
                  {busy === `cliniko:${r.number}` ? "Saving…" : "Save to Cliniko now"}
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
    </DashboardShell>
  );
}
