"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { euroText, dayText } from "@/core/hub-invoice";
import { typedEuroToMinor } from "@/core/vouchers";

/**
 * Gift vouchers (ADR 0008, plan-2026-10-28-gift-vouchers). Reception: look a
 * voucher up, use it for a treatment, undo a mistake, email it again, print it.
 * Selling stopped on 9 Nov 2026: existing vouchers can still be used. Owners also: refund, cancel, bring Vaoucher's
 * vouchers over, what's owed, and what was used with each therapist.
 */
export default function VouchersPage() {
  return (
    <StaffGate permission="vouchers:use" title="Gift vouchers">
      {() => <Vouchers />}
    </StaffGate>
  );
}

type Event = { id: string; at: string; kind: string; amountMinor: number; practitionerName: string | null; treatmentDay: string | null; byStaff: string | null; note: string; undone: boolean; unconfirmed: boolean };
type Voucher = {
  id: string;
  code: string;
  status: "active" | "cancelled";
  source: "online" | "desk" | "imported";
  amountMinor: number;
  balanceMinor: number;
  purchaseDay: string | null;
  expiresOn: string | null;
  expired: boolean;
  buyerName: string;
  buyerEmail: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  message: string | null;
  paidBy: string | null;
  paidOnline: boolean;
  emailedAt: string | null;
  sendOn?: string | null;
  heldMinor?: number;
  emailError: string | null;
  events: Event[];
};
type Overview = {
  today: string;
  canManage: boolean;
  practitioners: { id: string; name: string }[];
  recent: { id: string; code: string; status: string; source: string; amountMinor: number; balanceMinor: number; createdAt: string; forName: string; emailed: boolean; emailError: string | null }[];
  outstanding: { liveCount: number; liveMinor: number; expiredCount: number; expiredMinor: number } | null;
  period: { month: string; fromDay: string; toDay: string; therapists: { practitionerId: string; name: string; amountMinor: number; count: number }[] } | null;
};

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const KIND: Record<string, string> = { issued: "Value added", redeemed: "Used", undone: "Use undone", refunded: "Refunded", cancelled: "Cancelled", adjusted: "Adjusted" };
const SOURCE: Record<string, string> = { online: "Bought online", desk: "Sold at the desk", imported: "From Vaoucher" };

async function call(method: "GET" | "POST", url: string, body?: unknown) {
  const res = await fetch(url, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "That didn't work. Try again.");
  return json;
}

function Vouchers() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [period, setPeriod] = useState("");
  const [code, setCode] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [looking, setLooking] = useState(false);
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const cardRef = useRef<HTMLHeadingElement>(null);

  const loadOverview = useCallback(async (p?: string) => {
    try {
      setOverview(await call("GET", `/api/admin/vouchers?view=overview${p ? `&period=${p}` : ""}`));
      setLoadError("");
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);
  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // Each lookup or action moves focus to the voucher's heading once it has drawn (see VoucherCard).
  const [focusTick, setFocusTick] = useState(0);
  const show = (v: Voucher, r: { ok: boolean; text: string } | null = null) => {
    setVoucher(v);
    setResult(r);
    setFocusTick((n) => n + 1);
  };

  const lookUp = async (typed: string) => {
    setLooking(true);
    setLookupError("");
    try {
      const d = await call("GET", `/api/admin/vouchers?code=${encodeURIComponent(typed)}`);
      show(d.voucher);
    } catch (e: any) {
      setVoucher(null);
      setLookupError(e.message);
    }
    setLooking(false);
  };

  const after = async (v: Voucher, text: string) => {
    show(v, { ok: true, text });
    loadOverview(period || undefined);
  };

  return (
    <DashboardShell title="Gift vouchers" lede="Look up a voucher to use it for a treatment or send it again. Vouchers last 5 years and can be used over several visits.">
      <div className="stack-5">
        {loadError && (
          <Notice tone="error">
            <p>{loadError}</p>
          </Notice>
        )}

        <form
          className="field-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) lookUp(code);
          }}
        >
          <div className="field">
            <label htmlFor="v-code">Voucher code</label>
            <input id="v-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="NB-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} aria-describedby={lookupError ? "v-code-error" : undefined} aria-invalid={!!lookupError || undefined} />
          </div>
          <div className="field">
            <button className="btn btn-primary" type="submit" disabled={looking || !code.trim()}>
              {looking ? "Looking…" : "Look up"}
            </button>
          </div>
        </form>
        {lookupError && (
          <p className="field-error" id="v-code-error" role="alert">
            {lookupError}
          </p>
        )}

        {voucher && overview && <VoucherCard key={voucher.id} v={voucher} overview={overview} headingRef={cardRef} focusTick={focusTick} result={result} onDone={after} onError={(text) => setResult({ ok: false, text })} />}

        <Notice tone="info" title="Gift vouchers aren't sold any more">
          <p>No new vouchers can be made, online or at the desk. Existing vouchers can still be used: look the code up above and press Use for a treatment.</p>
        </Notice>

        {overview && (
          <section className="panel" aria-labelledby="v-recent">
            <h2 className="panel-title" id="v-recent">
              Sold in the last 60 days
            </h2>
            {overview.recent.length === 0 ? (
              <p className="secondary">None yet.</p>
            ) : (
              <div className="table-wrap" role="region" aria-label="Vouchers sold in the last 60 days" tabIndex={0}>
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Code</th>
                      <th scope="col">For</th>
                      <th scope="col">Value</th>
                      <th scope="col">Left</th>
                      <th scope="col">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recent.map((r) => (
                      <tr key={r.id}>
                        <td>{fmtWhen(r.createdAt)}</td>
                        <td>
                          <button className="link-button" type="button" onClick={() => lookUp(r.code)}>
                            {r.code}
                          </button>
                        </td>
                        <td>
                          {r.forName || "—"}
                          {r.source !== "online" && <span className="secondary"> ({SOURCE[r.source]})</span>}
                        </td>
                        <td className="tnum">{euroText(r.amountMinor)}</td>
                        <td className="tnum">{r.status === "cancelled" ? "Cancelled" : euroText(r.balanceMinor)}</td>
                        <td>{r.emailed ? "Sent" : r.source === "imported" ? "—" : r.emailError ? <span className="badge is-warn">Failed</span> : "Not sent"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {overview?.canManage && (
          <>
            {overview.outstanding && (
              <section className="panel" aria-labelledby="v-owed">
                <h2 className="panel-title" id="v-owed">
                  Owed on vouchers
                </h2>
                <p>
                  <strong className="tnum">{euroText(overview.outstanding.liveMinor)}</strong> on {overview.outstanding.liveCount} voucher{overview.outstanding.liveCount === 1 ? "" : "s"} that can still be used.
                  {overview.outstanding.expiredCount > 0 && ` ${euroText(overview.outstanding.expiredMinor)} was left on ${overview.outstanding.expiredCount} that have expired.`}
                </p>
                <p className="secondary">For the accountant: money taken for vouchers is owed until they&apos;re used.</p>
              </section>
            )}
            {overview.period && (
              <section className="panel" aria-labelledby="v-therapists">
                <h2 className="panel-title" id="v-therapists">
                  Used with each therapist
                </h2>
                <form
                  className="field-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    loadOverview(period || undefined);
                  }}
                >
                  <div className="field">
                    <label htmlFor="v-period">Month</label>
                    <input id="v-period" type="month" value={period || overview.period.month} onChange={(e) => setPeriod(e.target.value)} />
                  </div>
                  <div className="field">
                    <button className="btn btn-secondary" type="submit">
                      Show
                    </button>
                  </div>
                </form>
                <p className="secondary">
                  {dayText(overview.period.fromDay)} to {dayText(overview.period.toDay)}. Counted by the day it was entered here, so a month that&apos;s over never changes: an undo shows as a minus in the month it was undone.
                </p>
                {overview.period.therapists.length === 0 ? (
                  <p className="secondary">No vouchers used this month.</p>
                ) : (
                  <div className="table-wrap" role="region" aria-label="Vouchers used with each therapist" tabIndex={0}>
                    <table className="guide-table">
                      <thead>
                        <tr>
                          <th scope="col">Therapist</th>
                          <th scope="col">Treatments</th>
                          <th scope="col">Owed to them</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.period.therapists.map((t) => (
                          <tr key={t.practitionerId}>
                            <td>{t.name}</td>
                            <td className="tnum">{t.count}</td>
                            <td className="tnum">{euroText(t.amountMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
            <ImportVaoucher onDone={() => loadOverview(period || undefined)} />
          </>
        )}
      </div>
    </DashboardShell>
  );
}

function VoucherCard({
  v,
  overview,
  headingRef,
  focusTick,
  result,
  onDone,
  onError,
}: {
  v: Voucher;
  overview: Overview;
  headingRef: React.RefObject<HTMLHeadingElement>;
  focusTick: number;
  result: { ok: boolean; text: string } | null;
  onDone: (v: Voucher, text: string) => void;
  onError: (text: string) => void;
}) {
  const [open, setOpen] = useState<null | "use" | "email" | "refund" | "cancel" | { undo: string }>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [day, setDay] = useState(overview.today);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [emailTo, setEmailTo] = useState<"buyer" | "recipient">("buyer");
  const [emailAddr, setEmailAddr] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    headingRef.current?.focus();
  }, [focusTick, headingRef]);
  const usable = v.status === "active" && !v.expired && v.balanceMinor > 0;
  const toggle = (what: typeof open) => {
    setFormError("");
    setReason("");
    setAmount("");
    setOpen((o) => (JSON.stringify(o) === JSON.stringify(what) ? null : what));
  };
  const submit = async (body: Record<string, unknown>, done: (d: any) => string) => {
    setBusy(true);
    setFormError("");
    try {
      const d = await call("POST", "/api/admin/vouchers", { id: v.id, ...body });
      setOpen(null);
      onDone(d.voucher, done(d));
    } catch (e: any) {
      setFormError(e.message);
      onError(e.message);
    }
    setBusy(false);
  };
  const amountMinor = typedEuroToMinor(amount);

  return (
    <section className="panel" aria-labelledby="v-card">
      <h2 className="panel-title" id="v-card" tabIndex={-1} ref={headingRef}>
        Voucher {v.code}
      </h2>
      <div className="badge-row">
        <span className={v.balanceMinor > 0 && usable ? "badge is-good" : "badge"}>{euroText(v.balanceMinor)} left</span>
        <span className="badge">Value {euroText(v.amountMinor)}</span>
        {v.status === "cancelled" && <span className="badge is-bad">Cancelled</span>}
        {v.expiresOn && <span className={v.expired ? "badge is-bad" : "badge"}>{v.expired ? "Expired" : "Valid until"} {dayText(v.expiresOn)}</span>}
        {v.source !== "imported" && <span className={v.emailedAt ? "badge" : "badge is-warn"}>{v.emailedAt ? `Emailed ${fmtWhen(v.emailedAt)}` : "Not emailed"}</span>}
        {v.sendOn && <span className="badge">Goes to {v.recipientName || "them"} on {new Date(`${v.sendOn}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}</span>}
        {!!v.heldMinor && <span className="badge is-warn">{euroText(v.heldMinor)} set aside: an online booking is being paid</span>}
      </div>
      <p className="panel-meta">
        {SOURCE[v.source]}
        {v.purchaseDay ? ` on ${dayText(v.purchaseDay)}` : ""}
        {v.paidBy && v.source === "desk" ? ` (${v.paidBy})` : ""}
        {v.buyerName ? ` · bought by ${v.buyerName}${v.buyerEmail ? ` (${v.buyerEmail})` : ""}` : ""}
        {v.recipientName ? ` · for ${v.recipientName}${v.recipientEmail ? ` (${v.recipientEmail})` : ""}` : ""}
      </p>
      {v.message && <p className="secondary">Message: &ldquo;{v.message}&rdquo;</p>}
      {v.emailError && <p className="secondary">Email problem: {v.emailError}</p>}

      <p className={result?.ok === false ? "field-error" : "secondary"} role="status" aria-live="polite">
        {result?.text ?? ""}
      </p>

      <div className="table-wrap" role="region" aria-label="Voucher history" tabIndex={0}>
        <table className="guide-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What</th>
              <th scope="col">Amount</th>
              <th scope="col">Details</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {v.events.map((e) => (
              <tr key={e.id}>
                <td>{fmtWhen(e.at)}</td>
                <td>
                  {KIND[e.kind] ?? e.kind}
                  {e.undone && <span className="secondary"> (undone)</span>}
                  {e.unconfirmed && <span className="badge is-warn">Not confirmed by Stripe</span>}
                </td>
                <td className="tnum">{euroText(e.amountMinor)}</td>
                <td>
                  {[e.practitionerName && `with ${e.practitionerName}`, e.treatmentDay && dayText(e.treatmentDay), e.note, e.byStaff && `by ${e.byStaff}`].filter(Boolean).join(" · ")}
                </td>
                <td>
                  {e.unconfirmed && overview.canManage && (
                    <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => submit({ action: "confirm_refund", eventId: e.id }, (d) => d.message)}>
                      Check with Stripe<span className="visually-hidden"> about the refund of {euroText(-e.amountMinor)}</span>
                    </button>
                  )}
                  {e.kind === "redeemed" && !e.undone && v.status === "active" && (
                    <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => toggle({ undo: e.id })}>
                      Undo<span className="visually-hidden"> this use of {euroText(-e.amountMinor)}</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row-actions">
        {usable && (
          <button className="btn btn-primary" type="button" aria-expanded={open === "use"} onClick={() => toggle("use")}>
            Use for a treatment
          </button>
        )}
        {v.status === "active" && (
          <button className="btn btn-secondary" type="button" aria-expanded={open === "email"} onClick={() => toggle("email")}>
            Email again
          </button>
        )}
        {v.status === "active" && v.expiresOn && (
          <a className="btn btn-secondary" href={`/api/admin/vouchers/pdf?id=${v.id}`} target="_blank" rel="noopener noreferrer">
            Print / open PDF<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        )}
        {overview.canManage && v.status === "active" && v.balanceMinor > 0 && (
          <button className="btn btn-secondary" type="button" aria-expanded={open === "refund"} onClick={() => toggle("refund")}>
            Refund
          </button>
        )}
        {overview.canManage && v.status === "active" && (
          <button className="btn btn-secondary" type="button" aria-expanded={open === "cancel"} onClick={() => toggle("cancel")}>
            Cancel voucher
          </button>
        )}
      </div>

      {open === "use" && (
        <form
          className="panel-form stack-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!amountMinor) return setFormError("Enter the amount to take off, like 75 or 37.50.");
            if (!practitionerId) return setFormError("Choose the therapist.");
            submit({ action: "use", amountMinor, practitionerId, treatmentDay: day, note: note.trim() }, (d) => `${euroText(amountMinor)} used. ${euroText(d.balanceMinor)} left on the voucher.`);
          }}
        >
          <div className="field">
            <label htmlFor="u-amount">Amount to take off (€)</label>
            <p className="field-hint" id="u-amount-hint">
              Up to {euroText(v.balanceMinor)}. If the treatment costs more, take the rest as usual.
            </p>
            <input id="u-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby="u-amount-hint" />
            {v.balanceMinor > 0 && (
              <button type="button" className="link-button" onClick={() => setAmount((v.balanceMinor / 100).toFixed(2))}>
                Use all {euroText(v.balanceMinor)}
              </button>
            )}
          </div>
          <div className="field">
            <label htmlFor="u-prac">Therapist</label>
            <p className="field-hint" id="u-prac-hint">
              They&apos;re paid this amount by the clinic at the end of the month.
            </p>
            <select id="u-prac" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)} aria-describedby="u-prac-hint">
              <option value="">Choose…</option>
              {overview.practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="u-day">Treatment date</label>
            <input id="u-day" type="date" max={overview.today} value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-note">Note (optional)</label>
            <input id="u-note" value={note} maxLength={200} placeholder="e.g. Physio, 10:30am" onChange={(e) => setNote(e.target.value)} />
          </div>
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : amountMinor ? `Take ${euroText(amountMinor)} off the voucher` : "Take it off the voucher"}
          </button>
        </form>
      )}

      {open && typeof open === "object" && (
        <form
          className="panel-form stack-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ action: "undo", eventId: open.undo, reason }, (d) => `Undone. ${euroText(d.balanceMinor)} is back on the voucher.`);
          }}
        >
          <div className="field">
            <label htmlFor="un-reason">Why undo it?</label>
            <input id="un-reason" value={reason} maxLength={300} placeholder="e.g. used the wrong voucher" onChange={(e) => setReason(e.target.value)} />
          </div>
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || reason.trim().length < 3}>
            {busy ? "Undoing…" : "Undo this use"}
          </button>
        </form>
      )}

      {open === "email" && (
        <form
          className="panel-form stack-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ action: "email", to: emailTo, email: emailAddr.trim() || undefined }, (d) => `Emailed to ${d.sent.join(", ")}.`);
          }}
        >
          <fieldset className="field">
            <legend className="label">Send it to</legend>
            <label className="checkbox">
              <input type="radio" name="em-to" checked={emailTo === "buyer"} onChange={() => setEmailTo("buyer")} />
              <span>The buyer{v.buyerEmail ? ` (${v.buyerEmail})` : ""}</span>
            </label>
            <label className="checkbox">
              <input type="radio" name="em-to" checked={emailTo === "recipient"} onChange={() => setEmailTo("recipient")} />
              <span>The person it&apos;s for{v.recipientEmail ? ` (${v.recipientEmail})` : ""}</span>
            </label>
          </fieldset>
          <div className="field">
            <label htmlFor="em-addr">A different email address (optional)</label>
            <p className="field-hint" id="em-addr-hint">
              Only send a voucher to someone who has shown you they hold it: anyone with the code can use it.
            </p>
            <input id="em-addr" type="email" value={emailAddr} onChange={(e) => setEmailAddr(e.target.value)} aria-describedby="em-addr-hint" />
          </div>
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send the voucher"}
          </button>
        </form>
      )}

      {open === "refund" && (
        <form
          className="panel-form stack-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!amountMinor) return setFormError("Enter the amount to refund.");
            submit({ action: "refund", amountMinor, reason }, (d) => `${euroText(amountMinor)} refunded${v.paidOnline ? " to the buyer's card" : ""}. ${euroText(d.balanceMinor)} left on the voucher.`);
          }}
        >
          <p className="secondary">
            {v.paidOnline
              ? "Bought online: the refund goes back to the card the buyer paid with, through Stripe (5–10 working days)."
              : "Sold at the desk or brought over from Vaoucher: give the money back on the card machine or in cash first, then record it here."}{" "}
            It comes off the voucher straight away.
          </p>
          <div className="field">
            <label htmlFor="rf-amount">Amount (€)</label>
            <input id="rf-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rf-reason">Reason</label>
            <input id="rf-reason" value={reason} maxLength={300} placeholder="e.g. changed their mind within 14 days" onChange={(e) => setReason(e.target.value)} />
          </div>
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || reason.trim().length < 3}>
            {busy ? "Refunding…" : amountMinor ? `Refund ${euroText(amountMinor)}` : "Refund"}
          </button>
        </form>
      )}

      {open === "cancel" && (
        <form
          className="panel-form stack-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ action: "cancel", reason }, () => "Cancelled. It can't be used any more.");
          }}
        >
          <p className="secondary">For a voucher sold by mistake. Whatever is left ({euroText(v.balanceMinor)}) comes off and it can&apos;t be used again. This doesn&apos;t give any money back: use Refund for that.</p>
          <div className="field">
            <label htmlFor="cn-reason">Reason</label>
            <input id="cn-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </div>
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || reason.trim().length < 3}>
            {busy ? "Cancelling…" : "Cancel this voucher"}
          </button>
        </form>
      )}
    </section>
  );
}

function ImportVaoucher({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ rows: { code: string; balanceMinor: number; expiresOn: string; name: string }[]; problems: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  const send = async (confirm: boolean) => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const d = await call("POST", "/api/admin/vouchers", { action: "import", text, confirm });
      if (d.preview) setPreview({ rows: d.rows, problems: d.problems });
      else {
        setPreview(null);
        setText("");
        setDone(`${d.added} voucher${d.added === 1 ? "" : "s"} brought over.${d.skipped.length ? ` Already here, so skipped: ${d.skipped.join(", ")}.` : ""}`);
        onDone();
      }
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <details className="panel">
      <summary className="panel-title">Bring vouchers over from Vaoucher</summary>
      <div className="stack-4" style={{ marginTop: "var(--space-4)" }}>
        <p className="secondary">
          Paste Vaoucher&apos;s unused vouchers, one per line: code, amount left, expiry date, and optionally the name. For example: <code>XMAS-25-AB12, 50, 31/12/2030, Mary Byrne</code>. They keep their own codes. Check the list first; nothing is saved until you press
          Bring them over.
        </p>
        <div className="field">
          <label htmlFor="imp-text">Vouchers</label>
          <textarea
            id="imp-text"
            rows={6}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
          />
        </div>
        <div className="row-actions">
          <button className="btn btn-secondary" type="button" disabled={busy || !text.trim()} onClick={() => send(false)}>
            Check the list
          </button>
          {preview && !preview.problems.length && preview.rows.length > 0 && (
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => send(true)}>
              Bring {preview.rows.length} over ({euroText(preview.rows.reduce((s, r) => s + r.balanceMinor, 0))})
            </button>
          )}
        </div>
        <div role="status" aria-live="polite">
          {preview && preview.problems.length > 0 && (
            <Notice tone="warning" title="Fix these lines first">
              <ul>
                {preview.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Notice>
          )}
          {preview && !preview.problems.length && <p className="secondary">{preview.rows.length} vouchers look right.</p>}
          {done && <p>{done}</p>}
          {error && <p className="field-error">{error}</p>}
        </div>
      </div>
    </details>
  );
}
