"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Notice } from "@/components/Brand";
import PatientLookup, { type ChosenPatient } from "@/components/booking/PatientLookup";
import { PATIENT_KIND_OPTIONS, typesFor, type PatientKind } from "@/core/patient-kind";
import { DAY_PARTS, MAX_ENTRY_DAYS } from "@/core/waitlist";
import { toE164 } from "@/core/phone-booking";
import { whenShort } from "@/core/format";
import type { AppointmentType, Practitioner } from "@/components/booking/types";

/**
 * "Add a patient" on Dashboard → Waitlist (Clare, 6 Nov 2026: reception had no
 * way to put a caller on the waitlist). Find them in Cliniko or type their
 * details, choose what they're waiting for, confirm they agreed to be
 * contacted. Same rules as the patient's own form (lib/waitlist-join.ts): only
 * treatments and therapists bookable online, and if a time that fits is
 * already open, book that instead. The patient gets "you're on the list" with
 * a link to pause or leave.
 */
const BUSINESS_ID_OVERRIDE = process.env.NEXT_PUBLIC_DEFAULT_BUSINESS_ID || null;
const WEEK = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
];
const PART_HINT: Record<string, string> = { Morning: "before 12", Afternoon: "12 to 5", Evening: "after 5" };

type OpenTime = { practitionerId: string; practitionerName?: string; startsAtISO: string };

export default function WaitlistAdd({ canLookup, smsAvailable, onAdded, onClose }: { canLookup: boolean; smsAvailable: boolean; onAdded: (message: string, id: string) => void; onClose: () => void }) {
  const [businessId, setBusinessId] = useState<string | null>(BUSINESS_ID_OVERRIDE);
  const [types, setTypes] = useState<AppointmentType[] | null>(null);
  const [practitioners, setPractitioners] = useState<Practitioner[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const [chosen, setChosen] = useState<string | null>(null); // name of the Cliniko record picked, if any
  const [kind, setKind] = useState<PatientKind | null>(null);
  const [typeId, setTypeId] = useState("");
  const [practitionerId, setPractitionerId] = useState("any");
  const [days, setDays] = useState<number[]>([]);
  const [parts, setParts] = useState<string[]>([]);
  const [untilDay, setUntilDay] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);

  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<OpenTime[] | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    (businessId ? Promise.resolve(businessId) : fetch("/api/businesses").then((r) => r.json()).then((d) => d.businesses?.[0]?.id ?? null))
      .then((id) => {
        if (!id) throw new Error("no business");
        setBusinessId(String(id));
        return fetch("/api/appointment-types").then((r) => r.json());
      })
      .then((d) => setTypes(d.appointmentTypes ?? []))
      .catch(() => setLoadError("Couldn't load the treatments. Close this and try again in a minute."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setOpen(null);
    if (!typeId || !businessId) {
      setPractitioners(null);
      return;
    }
    setPractitioners(null);
    fetch(`/api/practitioners?appointmentTypeId=${typeId}&businessId=${businessId}`)
      .then((r) => r.json())
      .then((d) => {
        const list: Practitioner[] = d.practitioners ?? [];
        setPractitioners(list);
        setPractitionerId((cur) => (cur !== "any" && list.some((p) => p.id === cur) ? cur : "any"));
      })
      .catch(() => setPractitioners([]));
  }, [typeId, businessId]);

  const visibleTypes = useMemo(() => (types ? (kind ? typesFor(types, kind) : types) : []), [types, kind]);
  const grouped = useMemo(() => {
    const m = new Map<string, AppointmentType[]>();
    for (const t of visibleTypes) m.set(t.category ?? "Other", [...(m.get(t.category ?? "Other") ?? []), t]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleTypes]);
  useEffect(() => {
    if (typeId && !visibleTypes.some((t) => t.id === typeId)) setTypeId("");
  }, [visibleTypes, typeId]);

  const maxDay = useMemo(() => new Date(Date.now() + MAX_ENTRY_DAYS * 86_400_000).toISOString().slice(0, 10), []);
  const toggle = <T,>(list: T[], v: T, set: (l: T[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function choosePatient(p: ChosenPatient) {
    setChosen(p.name);
    setFirstName(p.prefill.firstName);
    setLastName(p.prefill.lastName);
    setEmail(p.prefill.email);
    setPhone(p.prefill.phone);
    if (p.suggestedKind) setKind(p.suggestedKind);
  }

  const problems: { id: string; text: string }[] = [
    ...(!kind ? [{ id: "wla-kind", text: "Choose whether they've been here before" }] : []),
    ...(!typeId ? [{ id: "wla-type", text: "Choose a treatment" }] : []),
    ...(!firstName.trim() ? [{ id: "wla-first", text: "Enter their first name" }] : []),
    ...(!lastName.trim() ? [{ id: "wla-last", text: "Enter their last name" }] : []),
    ...(!/^\S+@\S+\.\S+$/.test(email.trim()) ? [{ id: "wla-email", text: "Enter a valid email address (offers and their booking confirmation go there)" }] : []),
    ...(!toE164(phone) ? [{ id: "wla-phone", text: "Enter a mobile number, like 087 123 4567" }] : []),
    ...(!consent ? [{ id: "wla-consent", text: "Tick the box once they've agreed to be contacted" }] : []),
  ];
  const has = (id: string) => showErrors && problems.some((p) => p.id === id);

  async function submit() {
    setShowErrors(true);
    setError("");
    setOpen(null);
    if (problems.length) {
      requestAnimationFrame(() => resultRef.current?.focus());
      return;
    }
    if (!businessId || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          appointmentTypeId: typeId,
          practitionerId,
          businessId,
          days,
          parts,
          ...(untilDay ? { untilDay } : {}),
          patient: { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), phone: phone.trim() },
          visit: kind,
          wantsSms: true,
          consent: true,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        onAdded(d.message ?? "Added to the waitlist.", d.id);
        return;
      }
      if (d.code === "times_available") setOpen(d.times ?? []);
      setError(d.error ?? "Couldn't add them. Try again in a minute.");
    } catch {
      setError("Couldn't reach the Hub. Check the connection and try again.");
    }
    setBusy(false);
    requestAnimationFrame(() => resultRef.current?.focus());
  }

  return (
    <section className="panel stack-5" aria-labelledby="wla-heading">
      <h2 className="panel-title" id="wla-heading" ref={headingRef} tabIndex={-1}>
        Add a patient to the waitlist
      </h2>
      {loadError && (
        <Notice tone="error">
          <p>{loadError}</p>
        </Notice>
      )}

      <form className="stack-5" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {canLookup && (
          <>
            <PatientLookup onChoose={choosePatient} />
            {chosen && (
              <p className="secondary" role="status">
                Details filled in from {chosen}&apos;s Cliniko record. Check the email and mobile with them.
              </p>
            )}
          </>
        )}

        <fieldset className="kind-choice">
          <legend className="label">Have they been here before?</legend>
          <div className="kind-buttons">
            {PATIENT_KIND_OPTIONS.map((o, i) => (
              <button key={o.kind} id={i === 0 ? "wla-kind" : undefined} type="button" className="option kind-option" aria-pressed={kind === o.kind} onClick={() => setKind(o.kind)}>
                <span className="option-title">{o.title}</span>
                <span className="option-facts">{o.detail}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="wla-type">Treatment</label>
          <select id="wla-type" value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={!types} aria-invalid={has("wla-type") || undefined}>
            <option value="">{types ? "Choose a treatment" : "Loading…"}</option>
            {grouped.map(([cat, list]) => (
              <optgroup key={cat} label={cat}>
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="field-hint">Only treatments patients can book online can go on the waitlist.</p>
        </div>

        <div className="field">
          <label htmlFor="wla-prac">Therapist</label>
          <select id="wla-prac" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)} disabled={!typeId || !practitioners}>
            <option value="any">{typeId && !practitioners ? "Loading…" : "Any therapist (the soonest time)"}</option>
            {(practitioners ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="field">
          <legend className="label">Days that suit them</legend>
          <p className="field-hint">Leave all unticked if any day is fine.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
            {WEEK.map((d) => (
              <label className="checkbox" key={d.value}>
                <input type="checkbox" checked={days.includes(d.value)} onChange={() => toggle(days, d.value, setDays)} />
                <span>{d.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="label">Times of day</legend>
          <p className="field-hint">Leave all unticked if any time is fine.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
            {DAY_PARTS.map((p) => (
              <label className="checkbox" key={p}>
                <input type="checkbox" checked={parts.includes(p)} onChange={() => toggle(parts, p, setParts)} />
                <span>
                  {p} <span className="secondary">({PART_HINT[p]})</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="wla-until">Only until (optional)</label>
          <p className="field-hint">Stop looking after this date. Otherwise, up to {MAX_ENTRY_DAYS} days.</p>
          <input id="wla-until" type="date" min={new Date().toISOString().slice(0, 10)} max={maxDay} value={untilDay} onChange={(e) => setUntilDay(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="wla-first">First name</label>
          <input id="wla-first" autoComplete="off" value={firstName} onChange={(e) => setFirstName(e.target.value)} aria-invalid={has("wla-first") || undefined} />
        </div>
        <div className="field">
          <label htmlFor="wla-last">Last name</label>
          <input id="wla-last" autoComplete="off" value={lastName} onChange={(e) => setLastName(e.target.value)} aria-invalid={has("wla-last") || undefined} />
        </div>
        <div className="field">
          <label htmlFor="wla-email">Email</label>
          <input id="wla-email" type="email" autoComplete="off" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={has("wla-email") || undefined} />
        </div>
        <div className="field">
          <label htmlFor="wla-phone">Mobile</label>
          <p className="field-hint" id="wla-phone-hint">
            {smsAvailable ? "Offers are texted here." : "Offers are emailed until texts are switched on, then texted here."} Like 087 123 4567.
          </p>
          <input id="wla-phone" type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} aria-describedby="wla-phone-hint" aria-invalid={has("wla-phone") || undefined} />
        </div>

        <div className="field consent-block">
          <label className="checkbox">
            <input id="wla-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={has("wla-consent") || undefined} />
            <span>
              The patient agreed that Northbank can {smsAvailable ? "text" : "email"} them about times on the waitlist, and nothing else. They&apos;ll be sent a link to pause or leave at any time.
            </span>
          </label>
        </div>

        <div ref={resultRef} tabIndex={-1} aria-live="polite" className="stack-3">
          {showErrors && problems.length > 0 && (
            <Notice tone="error" title="Check these first">
              <ul>
                {problems.map((p) => (
                  <li key={p.id}>
                    <a href={`#${p.id}`}>{p.text}</a>
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          {error && (
            <Notice tone={open ? "warning" : "error"} title={open ? "A time is free already" : "Not added"}>
              <p>{error}</p>
              {open && open.length > 0 && (
                <ul>
                  {open.map((t) => (
                    <li key={`${t.practitionerId}:${t.startsAtISO}`} className="tnum">
                      {whenShort(t.startsAtISO)}
                      {t.practitionerName ? ` with ${t.practitionerName}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {open && (
                <p>
                  <a href="/dashboard/book">Book a patient in</a>, or change the days or times if none of these suit them.
                </p>
              )}
            </Notice>
          )}
        </div>

        <div className="row-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !types}>
            {busy ? "Adding…" : "Add to the waitlist"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
