"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { waitlistOn } from "@/core/waitlist-switch";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { formatDublin } from "@/core/policy";
import { whenShort, timeShort } from "@/core/format";
import { PATIENT_LOOKUP_PERMISSION } from "@/core/patient-lookup";
import WaitlistAdd from "@/components/dashboard/WaitlistAdd";

/**
 * Reception's waitlist board (core/waitlist.ts): who is waiting for what,
 * who has been offered a time (and until when), and what ended recently.
 * Pause or remove someone, take back an offer, or offer a time by hand.
 * Add a patient who asks by phone or at the desk (6 Nov 2026).
 */
export default function WaitlistPage() {
  return (
    <StaffGate permission="bookings:view" title="Waitlist">
      {(me) => <Waitlist canManage={me.permissions.includes("bookings:manage")} canLookup={me.permissions.includes(PATIENT_LOOKUP_PERMISSION)} />}
    </StaffGate>
  );
}

type Offer = { startsAtISO: string; practitioner: string; expiresAt: string; channels: string[]; manual: boolean };
type Row = {
  id: string;
  status: "active" | "paused" | "offered" | "filled" | "cancelled" | "expired";
  createdAt: string;
  closedAt: string | null;
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  addedBy: string | null;
  wantsSms: boolean;
  treatment: string;
  practitioner: string | null;
  days: number[];
  parts: string[];
  untilDay: string;
  ignoredInRow: number;
  lastOfferAt: string | null;
  blocked: string | null;
  offer: Offer | null;
};
type Data = { smsAvailable: boolean; stats: Record<string, number>; open: Row[]; closed: Row[] };
type Time = { practitionerId: string; practitionerName: string; startsAtISO: string };
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Waitlist({ canManage, canLookup }: { canManage: boolean; canLookup: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<{ id: string; times: Time[] | null } | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/waitlist", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't load the waitlist.");
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

  // One action at a time (a double tap can't send two offers), and a row's result is shown
  // in that person's own card with focus moved to it, not at the top of the page (audit M11).
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // a double tap arrives before the re-render that disables the buttons
  const [rowResult, setRowResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  async function act(body: Record<string, unknown>) {
    if (busyRef.current) return;
    busyRef.current = true;
    // "remove" takes the card away, so its result goes at the top of the page.
    const rowId = typeof body.id === "string" && body.action !== "remove" ? body.id : null;
    setBusy(true);
    setError("");
    setMessage("");
    if (rowId) setRowResult((m) => ({ ...m, [rowId]: { ok: true, text: "" } }));
    let result: { ok: boolean; text: string };
    try {
      const res = await fetch("/api/admin/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "That didn't work.");
      result = { ok: true, text: json.message ?? "Done." };
      setPicking(null);
      await load();
    } catch (e: any) {
      result = { ok: false, text: e.message };
    }
    busyRef.current = false;
    setBusy(false);
    if (rowId) {
      setRowResult((m) => ({ ...m, [rowId]: result }));
      requestAnimationFrame(() => document.getElementById(`wl-${rowId}`)?.focus());
    } else if (result.ok) setMessage(result.text);
    else setError(result.text);
  }

  async function showTimes(id: string) {
    if (picking?.id === id) {
      setPicking(null); // pressed again: close the list
      return;
    }
    setPicking({ id, times: null });
    try {
      const res = await fetch(`/api/admin/waitlist?times=${id}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't load times.");
      setPicking({ id, times: json.times });
      requestAnimationFrame(() => document.getElementById(`wl-times-${id}`)?.focus());
    } catch (e: any) {
      setError(e.message);
      setPicking(null);
    }
  }

  const wants = (r: Row) =>
    `${r.treatment} with ${r.practitioner ?? "any therapist"} · ${r.days.length ? r.days.map((d) => DAY[d]).join(" ") : "any day"}, ${r.parts.length ? r.parts.join("/").toLowerCase() : "any time"} · until ${r.untilDay}`;
  const s = data?.stats ?? {};

  return (
    <DashboardShell
      title="Waitlist"
      lede="Patients waiting for a time. When one opens up that suits them, they're texted a link to book it (emailed until texts are switched on), held for 2 hours. If they don't take it, it goes to the next person."
    >
      <div className="stack-5">
        {!waitlistOn() && (
          <Notice tone="warning" title="The waitlist is switched off">
            <p>
              Patients can&apos;t join or be added, and no offers are sent. Everyone already on the list keeps their place. To switch it back on, set
              NEXT_PUBLIC_WAITLIST=on in Vercel and redeploy.
            </p>
          </Notice>
        )}
        <div className="row-actions">
          <button className="btn btn-secondary" disabled={loading} onClick={load}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          {canManage && waitlistOn() && (
            <button className="btn btn-primary" aria-expanded={adding} aria-controls="wla-panel" disabled={busy} onClick={() => { setAdding((a) => !a); setMessage(""); setError(""); }}>
              Add a patient
            </button>
          )}
          {canManage && (
            <button className="btn btn-secondary" disabled={busy} onClick={() => act({ action: "sweep" })}>
              {busy ? "Working…" : "Look for times now"}
            </button>
          )}
        </div>

        {adding && (
          <div id="wla-panel">
            <WaitlistAdd
              canLookup={canLookup}
              smsAvailable={!!data?.smsAvailable}
              onClose={() => setAdding(false)}
              onAdded={async (text, id) => {
                setAdding(false);
                await load();
                setRowResult((m) => ({ ...m, [id]: { ok: true, text } }));
                requestAnimationFrame(() => document.getElementById(`wl-${id}`)?.focus());
              }}
            />
          </div>
        )}

        {data && !data.smsAvailable && (
          <Notice title="Texts are not switched on yet">
            <p>Offers go by email for now. Once texts are set up, they go by text only (email only if a text can't be sent).</p>
          </Notice>
        )}
        {message && (
          <Notice tone="success">
            <p>{message}</p>
          </Notice>
        )}
        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}

        {data && (
          <p className="secondary">
            Since this started: {s.offers ?? 0} offers sent, {s.filled ?? 0} booked, {s.lapsed ?? 0} not taken
            {s.refunded ? `, ${s.refunded} paid but the time had gone (refunded)` : ""}
            {s.sms_failed || s.email_failed ? `. Messages that failed: ${s.email_failed ?? 0} email, ${s.sms_failed ?? 0} text.` : "."}
          </p>
        )}

        {data && !loading && data.open.length === 0 && !error && <p className="secondary">Nobody is on the waitlist.</p>}

        {data?.open.map((r) => (
          <section key={r.id} className="panel" aria-labelledby={`wl-${r.id}`}>
            <h2 className="panel-title" id={`wl-${r.id}`} tabIndex={-1}>{r.patientName}</h2>
            <p className="panel-meta">{wants(r)}</p>
            <p className="panel-meta">
              {r.patientEmail} · {r.patientPhone}
              {r.wantsSms ? "" : " · email only"}
            </p>
            <div className="badge-row">
              {r.status === "offered" && r.offer && (
                <span className="badge is-warn">
                  Offered {whenShort(r.offer.startsAtISO)} with {r.offer.practitioner}, until {timeShort(r.offer.expiresAt)} ({r.offer.channels.join(" + ") || "sending"})
                  {r.offer.manual ? ", by reception" : ""}
                </span>
              )}
              {r.status === "paused" && <span className="badge">Paused{r.blocked ? `: ${r.blocked}` : ""}</span>}
              {r.status === "active" && r.blocked && <span className="badge">Waiting: {r.blocked}</span>}
              {r.status === "active" && !r.blocked && <span className="badge">Waiting</span>}
              {r.ignoredInRow > 0 && <span className="badge">{r.ignoredInRow} offer{r.ignoredInRow === 1 ? "" : "s"} not taken in a row</span>}
              <span className="badge">{r.addedBy ? `Added by ${r.addedBy},` : "Joined"} {formatDublin(r.createdAt)}</span>
            </div>
            <p className={rowResult[r.id]?.ok === false ? "field-error" : "secondary"} role="status" aria-live="polite">
              {rowResult[r.id]?.text ?? ""}
            </p>
            {canManage && (
              <div className="row-actions">
                {r.status === "offered" && (
                  <button className="btn btn-secondary" disabled={busy} onClick={() => act({ action: "withdraw", id: r.id })}>
                    Take back the offer
                  </button>
                )}
                {(r.status === "active" || r.status === "paused") && (
                  <button className="btn btn-secondary" disabled={busy} aria-expanded={picking?.id === r.id} aria-controls={`wl-pick-${r.id}`} onClick={() => showTimes(r.id)}>
                    Offer a time…
                  </button>
                )}
                {r.status === "active" && (
                  <button className="btn btn-secondary" disabled={busy} onClick={() => act({ action: "pause", id: r.id })}>
                    Pause
                  </button>
                )}
                {r.status === "paused" && (
                  <button className="btn btn-secondary" disabled={busy} onClick={() => act({ action: "resume", id: r.id })}>
                    Resume
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Remove ${r.patientName} from the waitlist?`)) act({ action: "remove", id: r.id });
                  }}
                >
                  Remove
                </button>
              </div>
            )}
            {picking?.id === r.id && (
              <div className="stack-3" id={`wl-pick-${r.id}`}>
                {!picking.times && <p className="secondary">Loading open times…</p>}
                {picking.times && picking.times.length === 0 && <p className="secondary">No open times in the next 2 weeks.</p>}
                {picking.times && picking.times.length > 0 && (
                  <>
                    <p className="secondary" id={`wl-times-${r.id}`} tabIndex={-1}>Open times for this treatment. Choosing one sends {r.patientName.split(" ")[0]} an offer now, held for up to 2 hours.</p>
                    <ul className="option-list">
                      {picking.times.map((t) => (
                        <li key={`${t.practitionerId}:${t.startsAtISO}`}>
                          <button
                            className="option"
                            disabled={busy}
                            onClick={() => act({ action: "offer", id: r.id, practitionerId: t.practitionerId, startsAtISO: t.startsAtISO })}
                          >
                            <span className="option-main">
                              <span className="option-title tnum">{whenShort(t.startsAtISO)}</span>
                              <span className="option-facts">{t.practitionerName}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </section>
        ))}

        {data && data.closed.length > 0 && (
          <>
            <h2>Ended in the last 14 days</h2>
            {data.closed.map((r) => (
              <section key={r.id} className="panel">
                <h3 className="panel-title">{r.patientName}</h3>
                <p className="panel-meta">{wants(r)}</p>
                <div className="badge-row">
                  <span className={`badge ${r.status === "filled" ? "" : "is-warn"}`}>{r.status === "filled" ? "Booked a time" : r.status === "cancelled" ? "Left or removed" : "Ran out"}</span>
                  {r.closedAt && <span className="badge">{formatDublin(r.closedAt)}</span>}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </DashboardShell>
  );
}
