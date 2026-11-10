"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { waitlistOn } from "@/core/waitlist-switch";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { ProblemSummary, focusSoon, type Problem } from "@/components/ProblemSummary";
import { CLINIC_PHONE, CLINIC_TEL, PRIVACY_URL } from "@/core/policy";
import { PATIENT_KIND_OPTIONS, typesFor, type PatientKind } from "@/core/patient-kind";
import { DAY_PARTS, MAX_ENTRY_DAYS, OFFER_WINDOW_MINUTES } from "@/core/waitlist";
import { toE164 } from "@/core/phone-booking";
import { whenShort } from "@/core/format";
import type { AppointmentType, Practitioner } from "@/components/booking/types";

/**
 * Join the waitlist (clinic request, 26 Oct 2026). One short form: what
 * you're waiting for, which days and times suit, your name, email and mobile.
 * When a time opens that fits, we text a link to book and pay for it (by email
 * until texts are set up); you have 2 hours to take it. Nothing is charged
 * until you pay. Texts only, no emails, once Twilio is live (Cian, 27 Oct 2026).
 */
const BUSINESS_ID_OVERRIDE = process.env.NEXT_PUBLIC_DEFAULT_BUSINESS_ID || null;
const WEEK: { label: string; value: number }[] = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
];
const PART_HINT: Record<string, string> = { Morning: "before 12", Afternoon: "12 to 5", Evening: "after 5" };

export default function WaitlistPage() {
  const [businessId, setBusinessId] = useState<string | null>(BUSINESS_ID_OVERRIDE);
  const [types, setTypes] = useState<AppointmentType[] | null>(null);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [smsAvailable, setSmsAvailable] = useState(false);

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
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ practitionerId: string; startsAtISO: string }[] | null>(null);
  const [done, setDone] = useState<{ told: "sms" | "email" | null; until: string } | null>(null);

  // Prefill from the booking page's link (?type=…&practitioner=…).
  const [preset, setPreset] = useState<{ type?: string; practitioner?: string }>({});
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setPreset({ type: q.get("type") ?? undefined, practitioner: q.get("practitioner") ?? undefined });
    document.title = "Join the waitlist · Northbank";
  }, []);

  useEffect(() => {
    fetch("/api/waitlist", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSmsAvailable(!!d.smsAvailable))
      .catch(() => {});
    (businessId ? Promise.resolve(businessId) : fetch("/api/businesses").then((r) => r.json()).then((d) => d.businesses?.[0]?.id ?? null))
      .then((id) => {
        if (!id) throw new Error("no business");
        setBusinessId(String(id));
        return fetch("/api/appointment-types").then((r) => r.json());
      })
      .then((d) => setTypes(d.appointmentTypes ?? []))
      .catch(() => setLoadError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (types && preset.type && types.some((t) => t.id === preset.type)) setTypeId(preset.type);
  }, [types, preset.type]);

  useEffect(() => {
    if (!typeId || !businessId) return;
    setPractitioners([]);
    fetch(`/api/practitioners?appointmentTypeId=${typeId}&businessId=${businessId}`)
      .then((r) => r.json())
      .then((d) => {
        const list: Practitioner[] = d.practitioners ?? [];
        setPractitioners(list);
        setPractitionerId(preset.practitioner && list.some((p) => p.id === preset.practitioner) ? preset.practitioner : "any");
      })
      .catch(() => setPractitioners([]));
  }, [typeId, businessId, preset.practitioner]);

  const visibleTypes = useMemo(() => (types ? (kind ? typesFor(types, kind) : types) : []), [types, kind]);
  const grouped = useMemo(() => {
    const m = new Map<string, AppointmentType[]>();
    for (const t of visibleTypes) m.set(t.category ?? "Other", [...(m.get(t.category ?? "Other") ?? []), t]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleTypes]);
  // Choosing "returning" after a new-patient treatment: drop a choice that no longer applies.
  useEffect(() => {
    if (typeId && !visibleTypes.some((t) => t.id === typeId)) setTypeId("");
  }, [visibleTypes, typeId]);

  const maxDay = useMemo(() => new Date(Date.now() + MAX_ENTRY_DAYS * 86_400_000).toISOString().slice(0, 10), []);
  const toggle = <T,>(list: T[], v: T, set: (l: T[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const problems = {
    kind: !kind,
    type: !typeId,
    firstName: !firstName.trim(),
    lastName: !lastName.trim(),
    email: !/^\S+@\S+\.\S+$/.test(email.trim()),
    phone: !toE164(phone),
    consent: !consent,
  };
  const invalid = Object.values(problems).some(Boolean);
  const summaryRef = useRef<HTMLDivElement>(null);
  // The same problems in page order, each linked to its field, for the "There is a problem" box (audit M4).
  const problemList: Problem[] = [
    ...(problems.kind ? [{ id: "wl-kind", text: "Choose whether you've been to see us before" }] : []),
    ...(problems.type ? [{ id: "wl-type", text: "Choose a treatment" }] : []),
    ...(problems.firstName ? [{ id: "wl-first", text: "Enter your first name" }] : []),
    ...(problems.lastName ? [{ id: "wl-last", text: "Enter your last name" }] : []),
    ...(problems.email ? [{ id: "wl-email", text: "Enter a valid email address" }] : []),
    ...(problems.phone ? [{ id: "wl-phone", text: "Enter a mobile number, like 087 123 4567" }] : []),
    ...(problems.consent ? [{ id: "wl-consent", text: "Tick the box to join the waitlist" }] : []),
  ];
  const described = (cond: boolean, id: string) => (showErrors && cond ? id : undefined);

  async function submit() {
    setShowErrors(true);
    setError(null);
    if (invalid) {
      focusSoon(() => summaryRef.current);
      return;
    }
    if (!businessId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      if (res.ok) setDone({ told: d.told ?? (d.emailed ? "email" : null), until: d.until });
      else if (d.code === "times_available") setOpen(d.times ?? []);
      else setError(d.error ?? d.message ?? `We couldn't add you to the waitlist. Please call us on ${CLINIC_PHONE}.`);
    } catch {
      setError("We couldn't add you to the waitlist. Please check your connection and try again.");
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

  if (!waitlistOn()) {
    return shell(
      <Notice tone="info" title="The waitlist is closed for now" actions={<a className="btn btn-secondary" href={CLINIC_TEL}><Icon name="phone" /> Call {CLINIC_PHONE}</a>}>
        <p>
          Please <a href="/">book a time online</a>, or call us and we&apos;ll find you one. If you&apos;re already on the waitlist, your place is kept.
        </p>
      </Notice>
    );
  }

  if (done) {
    return shell(
      <div className="stack-5">
        <div className="page-intro">
          <h1>You&apos;re on the waitlist</h1>
          <p className="lede">When a time opens up that suits you, we&apos;ll {smsAvailable ? "text" : "email"} you a link to book it. You&apos;ll have {OFFER_WINDOW_MINUTES / 60} hours to take it.</p>
        </div>
        <Notice tone="success" title="Nothing has been charged">
          <p>You only pay if you book a time we offer. {done.told === "sms"
              ? "We've texted you a link to pause or leave the waitlist at any time."
              : done.told === "email"
                ? "We've emailed you a link to pause or leave the waitlist at any time."
                : `We couldn't send your confirmation, but you are on the list. Call us on ${CLINIC_PHONE} if you want to change anything.`}</p>
        </Notice>
        <a className="btn btn-secondary" href="/">
          Back to booking
        </a>
      </div>
    );
  }

  if (open) {
    return shell(
      <div className="stack-5">
        <div className="page-intro">
          <h1>There&apos;s a time that fits right now</h1>
          <p className="lede">No need to wait. Here are the next times that suit what you chose:</p>
        </div>
        <ul className="option-list">
          {open.map((t) => (
            <li key={`${t.practitionerId}:${t.startsAtISO}`}>
              <span className="option">
                <span className="option-main">
                  <span className="option-title tnum">{whenShort(t.startsAtISO)}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
        <a className="btn btn-primary btn-block" href="/">
          Book a time now
        </a>
        <button className="btn btn-secondary" onClick={() => setOpen(null)}>
          Change what I chose
        </button>
      </div>
    );
  }

  if (loadError) {
    return shell(
      <Notice tone="error" title="We couldn't load the waitlist" actions={<a className="btn btn-secondary" href={CLINIC_TEL}><Icon name="phone" /> Call {CLINIC_PHONE}</a>}>
        <p>Please try again in a minute, or call us and we&apos;ll add you.</p>
      </Notice>
    );
  }

  const err = (cond: boolean, text: string, id: string) =>
    showErrors && cond ? (
      <p className="field-error" id={id}>
        <Icon name="alert" />
        <span>
          <span className="visually-hidden">Error: </span>
          {text}
        </span>
      </p>
    ) : null;

  return shell(
    <form className="stack-5" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="page-intro">
        <h1>Join the waitlist</h1>
        <p className="lede">
          Can&apos;t find a time that suits? Tell us what you&apos;re after. If one opens up, we&apos;ll {smsAvailable ? "text" : "email"} you a link to book it, and hold it for you for {OFFER_WINDOW_MINUTES / 60} hours. Nothing is charged unless you book.
        </p>
      </div>

      {showErrors && <ProblemSummary ref={summaryRef} problems={problemList} />}

      <fieldset className="kind-choice">
        <legend className="label">Have you been to see us before?</legend>
        {err(problems.kind, "Choose one", "kind-error")}
        <div className="kind-buttons">
          {PATIENT_KIND_OPTIONS.map((o, i) => (
            <button key={o.kind} id={i === 0 ? "wl-kind" : undefined} type="button" aria-describedby={i === 0 ? described(problems.kind, "kind-error") : undefined} className="option kind-option" aria-pressed={kind === o.kind} onClick={() => setKind(o.kind)}>
              <span className="option-title">{o.title}</span>
              <span className="option-facts">{o.detail}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="wl-type">Treatment</label>
        {err(problems.type, "Choose a treatment", "type-error")}
        <select id="wl-type" value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={!types} aria-invalid={(showErrors && problems.type) || undefined} aria-describedby={described(problems.type, "type-error")}>
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
      </div>

      <div className="field">
        <label htmlFor="wl-prac">Therapist</label>
        <select id="wl-prac" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)} disabled={!typeId}>
          <option value="any">Any therapist (the soonest time)</option>
          {practitioners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="field">
        <legend className="label">Days that suit you</legend>
        <p className="field-hint">Leave all unticked if any day is fine.</p>
        <div className="chip-row" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
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
        <label htmlFor="wl-until">Only until (optional)</label>
        <p className="field-hint">We&apos;ll stop looking after this date. Otherwise, up to {MAX_ENTRY_DAYS} days.</p>
        <input id="wl-until" type="date" min={new Date().toISOString().slice(0, 10)} max={maxDay} value={untilDay} onChange={(e) => setUntilDay(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="wl-first">First name</label>
        {err(problems.firstName, "Enter your first name", "first-error")}
        <input id="wl-first" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} aria-invalid={(showErrors && problems.firstName) || undefined} aria-describedby={described(problems.firstName, "first-error")} />
      </div>
      <div className="field">
        <label htmlFor="wl-last">Last name</label>
        {err(problems.lastName, "Enter your last name", "last-error")}
        <input id="wl-last" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} aria-invalid={(showErrors && problems.lastName) || undefined} aria-describedby={described(problems.lastName, "last-error")} />
      </div>
      <div className="field">
        <label htmlFor="wl-email">Email</label>
        {err(problems.email, "Enter a valid email address", "email-error")}
        <input id="wl-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={(showErrors && problems.email) || undefined} aria-describedby={described(problems.email, "email-error")} />
      </div>
      <div className="field">
        <label htmlFor="wl-phone">Mobile</label>
        <p className="field-hint" id="phone-hint">{smsAvailable ? "We'll text you here when a time opens up." : "We'll text you here when a time opens up (by email until texts start)."} Like 087 123 4567. Texts go to Irish mobiles only; for any other number we&apos;ll email you.</p>
        {err(problems.phone, "Enter a mobile number, like 087 123 4567", "phone-error")}
        <input id="wl-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={(showErrors && problems.phone) || undefined} aria-describedby={[described(problems.phone, "phone-error"), "phone-hint"].filter(Boolean).join(" ")} />
      </div>

      <div className="field consent-block">
        <p className="secondary">
          We keep your name, email and mobile on the waitlist only until you&apos;re booked, you leave, or it ends. We use them only to tell you about times that open up.{" "}
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
            Read our privacy notice<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </p>
        {err(problems.consent, "Tick the box to join the waitlist", "consent-error")}
        <label className="checkbox">
          <input id="wl-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={(showErrors && problems.consent) || undefined} aria-describedby={described(problems.consent, "consent-error")} />
          <span>{smsAvailable ? "I agree that Northbank can text me (or email me, if my number isn't an Irish mobile) about times on the waitlist, as described above. Nothing else." : "I agree that Northbank can text me (or email me, until texts start) about times on the waitlist, as described above. Nothing else."}</span>
        </label>
      </div>

      {error && (
        <Notice tone="error" title="Couldn't join the waitlist" actions={<a className="btn btn-secondary" href={CLINIC_TEL}><Icon name="phone" /> Call {CLINIC_PHONE}</a>}>
          <p>{error}</p>
        </Notice>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "Adding you…" : "Join the waitlist"}
      </button>
    </form>
  );
}
