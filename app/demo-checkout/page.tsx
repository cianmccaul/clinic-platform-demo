"use client";

/**
 * Demo only: stands in for Stripe's hosted checkout page. In production the
 * patient pays on Stripe's own page; card details never touch the clinic's site.
 * Here you can also choose to simulate the two things that can go wrong.
 */
import { useEffect, useState } from "react";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { euro } from "@/core/policy";
import { whenLong } from "@/core/format";
import { practitionerName, typeById } from "@/demo/server/clinic";
import type { CheckoutSession } from "@/demo/server/db";
import { payCheckout, type Simulate } from "@/demo/server/flows";
import { getDb, withDb } from "@/demo/server";

const OPTIONS: { id: Simulate; title: string; detail: string }[] = [
  { id: "none", title: "Everything works", detail: "The normal path: the appointment goes straight into the diary." },
  { id: "slot_taken", title: "Someone takes the time while I pay", detail: "Reception books the same time by phone. You keep your payment and get a link to pick another time." },
  { id: "diary_down", title: "The clinic diary is down", detail: "The booking can't be written even after retries, so you're refunded in full and the clinic is alerted." },
];

export default function DemoCheckout() {
  const [session, setSession] = useState<CheckoutSession | null | undefined>(undefined);
  const [simulate, setSimulate] = useState<Simulate>("none");
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("session");
    setSession(getDb().sessions.find((s) => s.id === id) ?? null);
  }, []);

  if (session === undefined) return null;
  const t = session && typeById(session.meta.appointmentTypeId);

  return (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        <div className="page-intro">
                    <h1>Pay {session ? euro(session.amount) : ""}</h1>
          <p className="lede">In the real system this is Stripe&apos;s own secure page. Nothing is charged here.</p>
        </div>
        {!session ? (
          <Notice tone="error" title="This payment page has expired">
            <p>
              <a href="/">Start a new booking</a>.
            </p>
          </Notice>
        ) : (
          <form
            className="stack-5"
            onSubmit={(e) => {
              e.preventDefault();
              setPaying(true);
              const r = withDb((db, now) => payCheckout(db, now, session.id, simulate));
              if ("error" in r && r.error) {
                setError(r.error);
                setPaying(false);
                return;
              }
              window.location.href = session.meta.returnUrl ?? `/booking/confirmed?session_id=${encodeURIComponent(session.id)}`;
            }}
          >
            <section className="panel">
              <h2 className="panel-title">{t?.name.replace(/ - .*$/, "")}</h2>
              <p className="panel-meta">
                {practitionerName(session.meta.practitionerId)}, {whenLong(session.meta.startsAtISO)}
              </p>
              <p className="panel-meta">
                Paid straight into {practitionerName(session.meta.practitionerId)}&apos;s own Stripe account. {session.meta.patient.firstName} {session.meta.patient.lastName}, {session.meta.patient.email}
              </p>
            </section>

            <section className="panel stack-4">
              <div className="field">
                <label htmlFor="card">Card number</label>
                <input id="card" value="4242 4242 4242 4242" readOnly />
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="exp">Expiry</label>
                  <input id="exp" value="12 / 30" readOnly />
                </div>
                <div className="field">
                  <label htmlFor="cvc">CVC</label>
                  <input id="cvc" value="123" readOnly />
                </div>
              </div>
            </section>

            {!session.meta.visitPaymentId && (
            <fieldset className="radio-list">
              <legend className="label">Simulate a problem (demo only)</legend>
              {OPTIONS.map((o) => (
                <label key={o.id} className="radio">
                  <input type="radio" name="simulate" checked={simulate === o.id} onChange={() => setSimulate(o.id)} />
                  <span>
                    <span className="radio-label">{o.title}</span>
                    <span className="radio-hint">{o.detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            )}

            {error && (
              <Notice tone="error">
                <p>{error}</p>
              </Notice>
            )}
            <div className="actions">
              <a className="btn btn-secondary" href={session.meta.returnUrl ? session.meta.returnUrl.replace("paid=1", "cancelled=1") : "/?cancelled=1"}>
                <Icon name="chevron-left" /> Back
              </a>
              <button className="btn btn-primary" disabled={paying}>
                {paying ? "Paying…" : `Pay ${euro(session.amount)}`}
              </button>
            </div>
          </form>
        )}
      </main>
    </>
  );
}
