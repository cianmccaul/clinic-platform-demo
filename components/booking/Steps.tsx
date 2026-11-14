"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Avatar, Icon, Notice, PhoneLink } from "@/components/Brand";
import { MARKETING_OPT_IN_HINT, MARKETING_OPT_IN_LABEL } from "@/core/mailerlite";
import { CLINIC_EMAIL, CLINIC_MAP_URL, CLINIC_PHONE, CLINIC_TEL, EXTRAS_SENTENCE, POLICY_SENTENCE, PRIVACY_CONSENT_LABEL, PRIVACY_CONSENT_TEXT, PRIVACY_CONSENT_TITLE, PRIVACY_URL } from "@/core/policy";
import { CLINIC_ADDRESS, checkoutLineItem, dayLabel, dayPart, dayShort, eur, timeShort, whenShort, type DayPart } from "@/core/format";
import { isTherapistOnlyCategory } from "@/core/areas";
import { bioHasMore, bioSummary, parseBio, type BioBlock, type Inline } from "@/core/bio";
import { LAPSED_NOTE, PATIENT_KIND_OPTIONS, typesFor, type PatientKind } from "@/core/patient-kind";
import type { AppointmentType, Patient, Practitioner, ReturningState, Step } from "./types";
import type { GapField } from "@/core/patient-details";

/**
 * The five booking screens. Presentational: every piece of state and every
 * request lives in app/page.tsx; these only render and report choices.
 */

// ---------------------------------------------------------------- shared

export function StepHead({ step, title, headingRef, children }: { step: Step; title: string; headingRef: RefObject<HTMLHeadingElement>; children?: ReactNode }) {
  return (
    <div className="step-head">
      <p className="progress">Step {step} of 5</p>
      <h1 ref={headingRef} tabIndex={-1}>
        {title}
      </h1>
      {children}
    </div>
  );
}

export function UnavailableNotice({ title = "We can't show online times right now" }: { title?: string }) {
  return (
    <Notice
      tone="error"
      title={title}
      actions={
        <>
          <a className="btn btn-primary" href={CLINIC_TEL}>
            <Icon name="phone" /> Call {CLINIC_PHONE}
          </a>
          <button className="btn btn-secondary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </>
      }
    >
      <p>Please call us and reception will book you in.</p>
    </Notice>
  );
}

// Everything is paid in full when it's booked (8 Oct 2026).
function priceFacts(t: AppointmentType) {
  const bits = [`${t.durationMinutes} min`];
  if (t.fullPriceEUR != null) bits.push(eur(t.fullPriceEUR));
  return bits.join(" · ");
}

// ---------------------------------------------------------------- 1. Treatment

const DISCIPLINE_ORDER = ["Physiotherapy", "Massage", "Acupuncture", "Osteopathy"];

/**
 * Areas booked somewhere else. They sit in the area list like any other, but
 * the tile is a link that takes the patient straight to that booking site.
 * A Cliniko category with the same name is hidden so it never appears twice.
 */
export const EXTERNAL_AREAS = [
  { name: "Podiatry", url: "https://example.com", site: "our partner clinic" },
];
const isExternalArea = (name: string) => EXTERNAL_AREAS.some((e) => e.name.toLowerCase() === name.toLowerCase());

/** The area (Cliniko category) a treatment belongs to. */
export const areaOf = (t: AppointmentType) => t.category?.trim() || "Other";

export function groupByArea(types: AppointmentType[]) {
  const groups = new Map<string, AppointmentType[]>();
  for (const t of types) groups.set(areaOf(t), [...(groups.get(areaOf(t)) ?? []), t]);
  const rank = (k: string) => {
    const i = DISCIPLINE_ORDER.findIndex((d) => k.toLowerCase().startsWith(d.toLowerCase()));
    return k === "Other" ? 999 : i === -1 ? 100 : i;
  };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

function areaFacts(list: AppointmentType[]) {
  const prices = list.map((t) => t.fullPriceEUR).filter((p): p is number => p != null);
  const count = `${list.length} ${list.length === 1 ? "appointment" : "appointments"}`;
  return prices.length ? `${count} · from ${eur(Math.min(...prices))}` : count;
}

/**
 * Step 1 in two parts, so the first screen is short: pick an area
 * (Physiotherapy, Massage, …), then the appointment within it. With only
 * one area, the area list is skipped.
 */
export function TreatmentStep({
  types: allTypes,
  kind,
  onChooseKind,
  loading,
  failed,
  selectedId,
  area,
  onChooseArea,
  onAllAreas,
  onChoose,
  headingRef,
}: {
  types: AppointmentType[];
  kind: PatientKind | null;
  onChooseKind: (k: PatientKind) => void;
  loading: boolean;
  failed: boolean;
  selectedId: string | null;
  area: string | null;
  onChooseArea: (area: string) => void;
  onAllAreas: () => void;
  onChoose: (t: AppointmentType) => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  // New or returning comes first; the list below is what that patient can book.
  const types = kind ? typesFor(allTypes, kind) : [];
  const groups = groupByArea(types).filter(([a]) => !isExternalArea(a) && !isTherapistOnlyCategory(a));
  const single = groups.length === 1 && EXTERNAL_AREAS.length === 0;
  const list = single ? groups[0][1] : area ? groups.find(([a]) => a === area)?.[1] ?? null : null;
  const showingArea = !loading && !failed && !!list;
  const title = showingArea && !single ? area! : "Choose a treatment";
  const chosenType = types.find((t) => t.id === selectedId);
  const ready = !loading && !failed && allTypes.length > 0; // the question only makes sense once there is something to book

  return (
    <section>
      <StepHead step={1} title={title} headingRef={headingRef}>
        <p className="lede">
          {showingArea
            ? "Choose an appointment. You pay the full fee when you book, so there\u2019s nothing to pay at the clinic."
            : ready && !kind
              ? "First, have you been to see us before?"
              : "Start with the kind of care you need."}
        </p>
      </StepHead>

      {ready && !showingArea && (
        <fieldset className="kind-choice">
          <legend className="visually-hidden">New or returning patient</legend>
          <div className="kind-buttons">
            {PATIENT_KIND_OPTIONS.map((o) => (
              <button key={o.kind} type="button" className="option kind-option" aria-pressed={kind === o.kind} onClick={() => onChooseKind(o.kind)}>
                <span className="option-title">{o.title}</span>
                <span className="option-facts">{o.detail}</span>
              </button>
            ))}
          </div>
          {kind === "lapsed" && <p className="kind-hint">{LAPSED_NOTE}</p>}
        </fieldset>
      )}

      {loading && (
        <div className="skeleton" aria-busy="true" aria-label="Loading treatments">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      )}

      {!loading && failed && <UnavailableNotice />}

      {!loading && !failed && allTypes.length === 0 && (
        <Notice title="No treatments can be booked online at the moment">
          <p>
            Please call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a> and reception will book you in.
          </p>
        </Notice>
      )}

      {/* Part 1: the areas */}
      {!loading && !failed && !list && kind && types.length > 0 && (
        <ul className="option-list">
          {groups.map(([a, items]) => (
            <li key={a}>
              <button className="option" aria-pressed={!!chosenType && areaOf(chosenType) === a} onClick={() => onChooseArea(a)}>
                <span className="option-main">
                  <span className="option-title">{a}</span>
                  <span className="option-facts">{areaFacts(items)}</span>
                </span>
                <Icon name="chevron-right" className="option-chevron" />
              </button>
            </li>
          ))}
          {EXTERNAL_AREAS.map((e) => (
            <li key={e.name}>
              <a className="option" href={e.url}>
                <span className="option-main">
                  <span className="option-title">{e.name}</span>
                  <span className="option-facts">Book on {e.site}</span>
                </span>
                <Icon name="external" className="option-chevron" />
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* Part 2: the appointments in that area */}
      {showingArea && (
        <>
          {!single && (
            <p className="area-back">
              <button className="link-button" onClick={onAllAreas}>
                <Icon name="chevron-left" /> All treatments
              </button>
            </p>
          )}
          <ul className="option-list">
            {list!.map((t) => (
              <li key={t.id}>
                <button className="option" aria-pressed={selectedId === t.id} onClick={() => onChoose(t)}>
                  <span className="option-main">
                    <span className="option-title">{t.name}</span>
                    <span className="option-facts">{priceFacts(t)}</span>
                    {t.notOnline && <span className="badge">Phone only: not bookable online</span>}
                    {t.description && <span className="option-desc">{firstLine(t.description)}</span>}
                  </span>
                  <Icon name="chevron-right" className="option-chevron" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {!loading && !failed && kind && types.length > 0 && (
        <p className="not-sure">
          Not sure? Start with a physio assessment, or <a href={CLINIC_TEL}>call us on {CLINIC_PHONE}</a>.
        </p>
      )}

      {/* Room Rentals: for therapists, booked through reception (core/areas.ts). */}
      {!loading && !failed && !list && (
        <div className="therapist-note">
          <p className="therapist-note-title">Renting a room? For therapists only</p>
          <p>
            Treatment rooms are available by the hour, half day or full day. Call <a href={CLINIC_TEL}>{CLINIC_PHONE}</a> or email{" "}
            <a href={`mailto:${CLINIC_EMAIL}?subject=Room%20rental`}>{CLINIC_EMAIL}</a> and reception will book it.
          </p>
        </div>
      )}
    </section>
  );
}

function firstLine(s: string) {
  const line = s.split(/\n/)[0].trim();
  return line.length > 140 ? `${line.slice(0, 137).trimEnd()}…` : line;
}

// ---------------------------------------------------------------- 2. Practitioner

export function PractitionerStep({
  practitioners,
  loading,
  failed,
  selectedId,
  firstAvailableChosen,
  onChoose,
  onChooseFirstAvailable,
  waitlistHref,
  headingRef,
}: {
  practitioners: Practitioner[];
  loading: boolean;
  failed: boolean;
  selectedId: string | null;
  firstAvailableChosen: boolean;
  onChoose: (p: Practitioner) => void;
  onChooseFirstAvailable: () => void;
  /** Link to join the waitlist for this treatment. */
  waitlistHref?: string;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  const firstAvailable = practitioners.find((p) => p.nextAvailableISO) ?? null;
  const bookable = practitioners.filter((p) => p.nextAvailableISO);
  const notOnline = practitioners.filter((p) => !p.nextAvailableISO);

  return (
    <section>
      <StepHead step={2} title="Choose a practitioner" headingRef={headingRef} />

      {loading && (
        <div className="skeleton" aria-busy="true" aria-label="Loading practitioners">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      )}

      {!loading && failed && <UnavailableNotice />}

      {!loading && !failed && bookable.length === 0 && (
        <Notice title="No online times for this treatment right now">
          <p>
            Please call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a>. Reception can often find a time that isn&apos;t shown online.
          </p>
        </Notice>
      )}

      {!loading && !failed && firstAvailable && (
        <ul className="option-list">
          <li>
            <button className="option" aria-pressed={firstAvailableChosen} onClick={onChooseFirstAvailable}>
              <span className="option-main">
                <span className="option-title">First available</span>
                <span className="option-facts">
                  {whenShort(firstAvailable.nextAvailableISO!)} with {firstAvailable.firstName} {firstAvailable.lastName}
                </span>
              </span>
              <Icon name="chevron-right" className="option-chevron" />
            </button>
          </li>
          {bookable.map((p) => (
            <li key={p.id}>
              <PractitionerRow p={p} selected={!firstAvailableChosen && selectedId === p.id} onChoose={() => onChoose(p)} />
            </li>
          ))}
        </ul>
      )}

      {!loading && !failed && notOnline.length > 0 && bookable.length > 0 && (
        <p className="not-sure">
          {notOnline.map((p) => `${p.firstName} ${p.lastName}`).join(", ")} {notOnline.length === 1 ? "has" : "have"} no online times for this
          treatment. <a href={CLINIC_TEL}>Call {CLINIC_PHONE}</a> to book with them.
        </p>
      )}

      {!loading && !failed && waitlistHref && (
        <p className="not-sure">
          Nothing that suits? <a href={waitlistHref}>Join the waitlist</a> and we&apos;ll let you know when a time opens up.
        </p>
      )}
    </section>
  );
}

function Rich({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((x, i) => (x.strong ? <strong key={i}>{x.text}</strong> : <Fragment key={i}>{x.text}</Fragment>))}
    </>
  );
}

/** A practitioner's Cliniko bio, laid out from plain text by core/bio.ts (never rendered as HTML). */
function Bio({ blocks }: { blocks: BioBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "tags":
            return null; // shown above, in the collapsed row too
          case "heading":
            return (
              <p key={i} className="bio-heading">
                {b.text}
              </p>
            );
          case "list":
            return (
              <ul key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Rich parts={item} />
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <figure key={i} className="bio-quote">
                <blockquote>
                  <p>{b.text}</p>
                </blockquote>
                {b.by && <figcaption>{b.by}</figcaption>}
              </figure>
            );
          default:
            return (
              <p key={i}>
                <Rich parts={b.parts} />
              </p>
            );
        }
      })}
    </>
  );
}

function PractitionerRow({ p, selected, onChoose }: { p: Practitioner; selected: boolean; onChoose: () => void }) {
  const [open, setOpen] = useState(false);
  const bioId = `bio-${p.id}`;
  const blocks = useMemo(() => parseBio(p.description), [p.description]);
  const tags = blocks.find((b) => b.kind === "tags");
  const summary = bioSummary(blocks);
  const more = bioHasMore(blocks);
  return (
    <div className="practitioner">
      <button className="option option-with-media" aria-pressed={selected} onClick={onChoose}>
        <Avatar name={p} url={p.profilePictureUrl} />
        <span className="option-main">
          <span className="option-title">
            {p.firstName} {p.lastName}
          </span>
          {p.notOnline && <span className="badge">Phone only: not bookable online</span>}
          {p.title && <span className="option-facts">{p.title}</span>}
          {p.nextAvailableISO && <span className="option-facts">Next available: {whenShort(p.nextAvailableISO)}</span>}
        </span>
        <Icon name="chevron-right" className="option-chevron" />
      </button>
      {blocks.length > 0 && (
        <div className="bio">
          {tags && tags.kind === "tags" && (
            <ul className="bio-tags" aria-label={`${p.firstName}'s specialties`}>
              {tags.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          <div id={bioId} className="bio-body">
            {open ? (
              <Bio blocks={blocks} />
            ) : (
              summary && (
                <p className="is-clamped">
                  <Rich parts={summary} />
                </p>
              )
            )}
          </div>
          {more && (
            <button className="link-button bio-toggle" aria-expanded={open} aria-controls={bioId} onClick={() => setOpen(!open)}>
              {open ? "Show less" : `Read more about ${p.firstName}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 3. Time

export type WeekDay = { day: string; count: number; past: boolean };

export function TimeStep({
  practitioner,
  weekStart,
  days,
  canGoBack,
  canGoForward,
  onWeek,
  selectedDay,
  onSelectDay,
  slots,
  selectedTime,
  onSelectTime,
  loading,
  failed,
  nextAvailableISO,
  onJumpTo,
  onContinue,
  notice,
  waitlistHref,
  headingRef,
}: {
  practitioner: Practitioner;
  weekStart: string;
  days: WeekDay[];
  canGoBack: boolean;
  canGoForward: boolean;
  onWeek: (delta: number) => void;
  selectedDay: string | null;
  onSelectDay: (day: string) => void;
  slots: string[];
  selectedTime: string | null;
  onSelectTime: (iso: string) => void;
  loading: boolean;
  failed: boolean;
  nextAvailableISO: string | null;
  onJumpTo: (day: string) => void;
  onContinue: () => void;
  notice: ReactNode;
  /** Link to join the waitlist for this treatment and practitioner. */
  waitlistHref?: string;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  const [jump, setJump] = useState("");
  const weekEmpty = !loading && !failed && days.every((d) => d.count === 0);
  const groups = (["Morning", "Afternoon", "Evening"] as DayPart[])
    .map((part) => ({ part, times: slots.filter((t) => dayPart(t) === part) }))
    .filter((g) => g.times.length > 0);
  const start = dayLabel(weekStart);
  const end = dayLabel(days[6]?.day ?? weekStart);
  const nextDay = nextAvailableISO ? dublinDate(nextAvailableISO) : null;
  const nextIsLater = !!nextDay && days.length === 7 && nextDay > days[6].day;

  return (
    <section>
      <StepHead step={3} title="Choose a time" headingRef={headingRef}>
        <p className="lede">
          With {practitioner.firstName} {practitioner.lastName}. All times are Irish time.
        </p>
      </StepHead>

      {notice}

      <div className="week-nav">
        <button className="icon-button" onClick={() => onWeek(-1)} disabled={!canGoBack || loading} aria-label="Previous week">
          <Icon name="chevron-left" />
        </button>
        <p className="week-nav-label" aria-live="polite">
          {start.full} to {end.full}
        </p>
        <button className="icon-button" onClick={() => onWeek(1)} disabled={!canGoForward || loading} aria-label="Next week">
          <Icon name="chevron-right" />
        </button>
      </div>

      <ul className="week-strip" aria-label="Days this week">
        {days.map((d) => {
          const l = dayLabel(d.day);
          const none = d.count === 0;
          return (
            <li key={d.day}>
              <button
                className="day"
                aria-pressed={selectedDay === d.day}
                disabled={loading || none}
                onClick={() => onSelectDay(d.day)}
                aria-label={`${l.full}${loading ? "" : none ? ", no times" : `, ${d.count} ${d.count === 1 ? "time" : "times"}`}`}
              >
                <span className="day-weekday">{l.weekday}</span>
                <span className="day-date">{l.date}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {loading && (
        <div className="skeleton" aria-busy="true" aria-label="Checking times">
          <div className="skeleton-slots">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="skeleton-row is-short" />
            ))}
          </div>
        </div>
      )}

      {!loading && failed && <UnavailableNotice title="We can't check times right now" />}

      {weekEmpty && (
        <Notice
          title="No online times this week"
          actions={
            nextIsLater ? (
              <button className="btn btn-secondary" onClick={() => onJumpTo(nextDay!)}>
                Show {dayShort(nextAvailableISO!)}
              </button>
            ) : canGoForward ? (
              <button className="btn btn-secondary" onClick={() => onWeek(1)}>
                Show next week
              </button>
            ) : undefined
          }
        >
          <p>{nextIsLater ? `Next available: ${dayShort(nextAvailableISO!)}.` : <>Try another week, or call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a>.</>}</p>
        </Notice>
      )}

      {!loading && !failed && selectedDay && groups.length > 0 && (
        <div aria-label={`Times on ${dayLabel(selectedDay).full}`} role="group">
          {groups.map((g) => (
            <div className="slot-group" key={g.part}>
              <h3>{g.part}</h3>
              <ul className="slot-grid">
                {g.times.map((t) => (
                  <li key={t}>
                    <button className="slot" aria-pressed={selectedTime === t} onClick={() => onSelectTime(t)}>
                      {timeShort(t)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="jump-to-date">
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{4}-\d{2}-\d{2}$/.test(jump)) onJumpTo(jump);
          }}
        >
          <div className="field">
            <label htmlFor="jump-date">Jump to a date</label>
            <input id="jump-date" type="date" value={jump} onChange={(e) => setJump(e.target.value)} />
          </div>
          <button className="btn btn-secondary" type="submit" disabled={!jump}>
            Show times
          </button>
        </form>
      </div>

      {!loading && !failed && waitlistHref && (
        <p className="not-sure">
          Can&apos;t find a time that suits? <a href={waitlistHref}>Join the waitlist</a> and we&apos;ll let you know when one opens up.
        </p>
      )}

      <div className="sticky-bar">
        <div className="sticky-bar-inner">
          <p className="sticky-bar-text tnum">{selectedTime ? whenShort(selectedTime) : "Choose a time"}</p>
          <button className="btn btn-primary" onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    </section>
  );
}

function dublinDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

// ---------------------------------------------------------------- 4. Details

export const HEARD_ABOUT_US_OPTIONS = [
  "Google search",
  "Referral from a friend or family member",
  "Referral from a GP or other healthcare provider",
  "Social media",
  "Walked past / saw the clinic",
  "Other",
];

export type DetailField = "firstName" | "lastName" | "email" | "phone" | "dateOfBirth" | "address" | "gpName" | "heardAboutUs";
export type FieldErrors = Partial<Record<DetailField, string>>;

const FIELD_ORDER: DetailField[] = ["firstName", "lastName", "email", "phone", "dateOfBirth", "address", "gpName", "heardAboutUs"];

/**
 * Date of birth as three boxes (day, month, year), the GOV.UK pattern.
 * A phone's date picker opens on today, so someone born in 1958 had to
 * scroll back 68 years (review, 15 Oct). The value stays "YYYY-M-D" as
 * typed; BookingFlow pads it (normaliseDateOfBirth) before checking it.
 */
function DateOfBirthField({
  value,
  onChange,
  error,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  error: ReactNode;
  invalid: boolean;
}) {
  const [year = "", month = "", day = ""] = value ? value.split("-") : [];
  const put = (y: string, m: string, d: string) => onChange(y || m || d ? `${y}-${m}-${d}` : "");
  const digits = (s: string, max: number) => s.replace(/\D/g, "").slice(0, max);
  const box = (
    id: string,
    label: string,
    v: string,
    max: number,
    ac: string,
    width: string,
    change: (s: string) => void
  ) => (
    <div className="date-part">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={ac}
        maxLength={max}
        style={{ width }}
        value={v}
        onChange={(e) => change(digits(e.target.value, max))}
        aria-invalid={invalid || undefined}
        aria-describedby={["dateOfBirth-hint", invalid ? "dateOfBirth-error" : null].filter(Boolean).join(" ")}
      />
    </div>
  );
  return (
    <fieldset className="field date-field">
      <legend>Date of birth</legend>
      <p className="field-hint" id="dateOfBirth-hint">
        For example, 2 4 1958
      </p>
      {error}
      <div className="date-parts">
        {/* The day box carries id="dateOfBirth" so the error summary link lands on it. */}
        {box("dateOfBirth", "Day", day, 2, "bday-day", "calc(3ch + 2 * var(--space-3) + 4px)", (d) => put(year, month, d))}
        {box("dateOfBirth-month", "Month", month, 2, "bday-month", "calc(3ch + 2 * var(--space-3) + 4px)", (m) => put(year, m, day))}
        {box("dateOfBirth-year", "Year", year, 4, "bday-year", "calc(5ch + 2 * var(--space-3) + 4px)", (y) => put(y, month, day))}
      </div>
    </fieldset>
  );
}

/** A referral option asks who referred them. */
export const isReferralOption = (o: string) => /referral/i.test(o);

/**
 * The patient-record fields, shared by the full form (new patients) and the
 * short "just what we're missing" form for returning patients. `only`
 * limits it to some fields (each with the ones that belong with it).
 */
function DetailFields({
  patient,
  setPatient,
  errors,
  only,
}: {
  patient: Patient;
  setPatient: (p: Patient) => void;
  errors: FieldErrors;
  only?: GapField[];
}) {
  const show = (f: GapField) => !only || only.includes(f);
  const set = (k: keyof Patient) => (e: { target: { value: string } }) => setPatient({ ...patient, [k]: e.target.value });
  const err = (k: DetailField) =>
    errors[k] ? (
      <p className="field-error" id={`${k}-error`}>
        <Icon name="alert" />
        <span>
          <span className="visually-hidden">Error: </span>
          {errors[k]}
        </span>
      </p>
    ) : null;
  const describedBy = (k: DetailField, hint?: string) => [hint, errors[k] ? `${k}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <>
      {show("phone") && (
        <div className="field">
          <label htmlFor="phone">Mobile</label>
          <p className="field-hint" id="phone-hint">
            For appointment reminders, and so we can reach you if something changes.
          </p>
          {err("phone")}
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={patient.phone}
            onChange={set("phone")}
            aria-invalid={!!errors.phone || undefined}
            aria-describedby={describedBy("phone", "phone-hint")}
          />
        </div>
      )}
      {show("dateOfBirth") && (
        <DateOfBirthField
          value={patient.dateOfBirth}
          onChange={(v) => setPatient({ ...patient, dateOfBirth: v })}
          error={err("dateOfBirth")}
          invalid={!!errors.dateOfBirth}
        />
      )}
      {show("address") && (
        <>
          <div className="field">
            <label htmlFor="address">Address</label>
            <p className="field-hint" id="address-hint">
              House number, street and area.
            </p>
            {err("address")}
            <input
              id="address"
              autoComplete="street-address"
              value={patient.address}
              onChange={set("address")}
              aria-invalid={!!errors.address || undefined}
              aria-describedby={describedBy("address", "address-hint")}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="county">County (optional)</label>
              <input id="county" autoComplete="address-level1" value={patient.county} onChange={set("county")} />
            </div>
            <div className="field">
              <label htmlFor="eircode">Eircode (optional)</label>
              <input id="eircode" autoComplete="postal-code" className="input-short" value={patient.eircode} onChange={set("eircode")} />
            </div>
          </div>
        </>
      )}
      {show("gpName") && (
        <div className="field">
          <label htmlFor="gpName">Your GP</label>
          <p className="field-hint" id="gpName-hint">
            Your family doctor&apos;s name and practice. If you don&apos;t have one, write &ldquo;None&rdquo;.
          </p>
          {err("gpName")}
          <input
            id="gpName"
            autoComplete="off"
            value={patient.gpName}
            onChange={set("gpName")}
            aria-invalid={!!errors.gpName || undefined}
            aria-describedby={describedBy("gpName", "gpName-hint")}
          />
        </div>
      )}
      {show("heardAboutUs") && (
        <>
          <div className="field">
            <label htmlFor="heardAboutUs">How did you hear about us? (optional)</label>
            {err("heardAboutUs")}
            <select
              id="heardAboutUs"
              value={patient.heardAboutUs}
              onChange={set("heardAboutUs")}
              aria-invalid={!!errors.heardAboutUs || undefined}
              aria-describedby={describedBy("heardAboutUs")}
            >
              <option value="">Choose an option</option>
              {HEARD_ABOUT_US_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          {(isReferralOption(patient.heardAboutUs) || patient.heardAboutUs === "Other") && (
            <div className="field">
              <label htmlFor="referredBy">{patient.heardAboutUs === "Other" ? "Tell us more (optional)" : "Who referred you? (optional)"}</label>
              <input id="referredBy" autoComplete="off" value={patient.referredBy} onChange={set("referredBy")} />
            </div>
          )}
        </>
      )}
    </>
  );
}

function ErrorSummary({ errors, summaryRef }: { errors: FieldErrors; summaryRef: RefObject<HTMLDivElement> }) {
  const errorKeys = FIELD_ORDER.filter((k) => errors[k]);
  if (!errorKeys.length) return null;
  return (
    <div className="error-summary" ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="error-summary-title">
      <h2 id="error-summary-title">
        <Icon name="alert" /> There is a problem
      </h2>
      <ul>
        {errorKeys.map((k) => (
          <li key={k}>
            <a
              href={`#${k}`}
              onClick={(e) => {
                // Focus the field without adding a history entry (Back stays on this step).
                const el = document.getElementById(k);
                if (!el) return;
                e.preventDefault();
                el.scrollIntoView({ block: "center" });
                el.focus({ preventScroll: true });
              }}
            >
              {errors[k]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DetailsStep({
  patient,
  setPatient,
  errors,
  summaryRef,
  returning,
  setReturning,
  onStartReturning,
  onVerifyReturning,
  onResetReturning,
  onContinue,
  devFill,
  staff = false,
  newPatient = false,
  headingRef,
}: {
  staff?: boolean;
  /** A first visit has no record with us yet, so the shortcut isn't offered. */
  newPatient?: boolean;
  patient: Patient;
  setPatient: (p: Patient) => void;
  errors: FieldErrors;
  summaryRef: RefObject<HTMLDivElement>;
  returning: ReturningState;
  setReturning: (r: ReturningState) => void;
  onStartReturning: () => void;
  onVerifyReturning: () => void;
  onResetReturning: () => void;
  onContinue: () => void;
  devFill?: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  // Code entered: their details come from their record (saved card or not), so only the gaps are asked.
  const saved = returning.stage === "verified" && !!returning.token;
  const set = (k: keyof Patient) => (e: { target: { value: string } }) => setPatient({ ...patient, [k]: e.target.value });
  const err = (k: DetailField) =>
    errors[k] ? (
      <p className="field-error" id={`${k}-error`}>
        <Icon name="alert" />
        <span>
          <span className="visually-hidden">Error: </span>
          {errors[k]}
        </span>
      </p>
    ) : null;
  const describedBy = (k: DetailField, hint?: string) => [hint, errors[k] ? `${k}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <section>
      <StepHead step={4} title={staff ? "Patient's details" : "Your details"} headingRef={headingRef}>
        <p className="lede">
          {staff
            ? "Ask the patient for each one. If they're already in Cliniko, only empty fields are filled in; nothing there is changed."
            : "These go on your patient record, so your practitioner has everything they need and we can send your confirmation."}
        </p>
      </StepHead>

      <ErrorSummary errors={errors} summaryRef={summaryRef} />

      {!staff && (!newPatient || returning.stage !== "idle") && (
        <ReturningPatient
          returning={returning}
          setReturning={setReturning}
          onStart={onStartReturning}
          onVerify={onVerifyReturning}
          onReset={onResetReturning}
        />
      )}

      {!saved && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onContinue();
          }}
        >
          {devFill && (
            <button type="button" className="dev-autofill" onClick={devFill}>
              Dev only: fill test patient
            </button>
          )}

          <div className="field-row">
            <div className="field">
              <label htmlFor="firstName">First name</label>
              {err("firstName")}
              <input
                id="firstName"
                autoComplete="given-name"
                value={patient.firstName}
                onChange={set("firstName")}
                aria-invalid={!!errors.firstName || undefined}
                aria-describedby={describedBy("firstName")}
              />
            </div>
            <div className="field">
              <label htmlFor="lastName">Last name</label>
              {err("lastName")}
              <input
                id="lastName"
                autoComplete="family-name"
                value={patient.lastName}
                onChange={set("lastName")}
                aria-invalid={!!errors.lastName || undefined}
                aria-describedby={describedBy("lastName")}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <p className="field-hint" id="email-hint">
              Your confirmation goes here.
            </p>
            {err("email")}
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              value={patient.email}
              onChange={set("email")}
              aria-invalid={!!errors.email || undefined}
              aria-describedby={describedBy("email", "email-hint")}
            />
          </div>

          <DetailFields patient={patient} setPatient={setPatient} errors={errors} />

          <p className="field-hint" style={{ marginTop: "var(--space-5)" }}>
            Why we ask: so your practitioner has your full history, and can contact your GP if your treatment needs it. You&apos;ll see the
            clinic&apos;s privacy agreement on the next screen.
          </p>

          <div className="step-actions">
            <button className="btn btn-primary" type="submit">
              Continue
            </button>
          </div>
        </form>
      )}

      {saved && (
        <form
          noValidate
          style={{ marginTop: "var(--space-5)" }}
          onSubmit={(e) => {
            e.preventDefault();
            onContinue();
          }}
        >
          {returning.missing.length > 0 && (
            <div className="stack-3">
              <h2>A few details we don&apos;t have yet</h2>
              <p className="field-hint">We only ask once. They&apos;re added to your patient record; nothing already there is changed.</p>
              <DetailFields patient={patient} setPatient={setPatient} errors={errors} only={returning.missing} />
            </div>
          )}
          <div className="step-actions">
            <button className="btn btn-primary" type="submit">
              Continue
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ReturningPatient({
  returning,
  setReturning,
  onStart,
  onVerify,
  onReset,
}: {
  returning: ReturningState;
  setReturning: (r: ReturningState) => void;
  onStart: () => void;
  onVerify: () => void;
  onReset: () => void;
}) {
  const r = returning;
  if (r.stage === "verified" && r.card) {
    return (
      <Notice tone="success" title={`Paying with your saved ${r.card.brand} card ending ${r.card.last4}`}>
        <p>
          {r.missing.length
            ? "We have most of your details on file. Please fill in the few we're missing below."
            : "Your details are already on file, so there's nothing to fill in."}
        </p>
        <button className="link-button" onClick={onReset}>
          Use a different card instead
        </button>
      </Notice>
    );
  }
  // No saved card: their record is used, and they pay by card on the payment page (core/returning-checkout.ts).
  if (r.stage === "verified" && r.token) {
    return (
      <Notice tone="success" title="We've found your details">
        <p>
          {r.missing.length
            ? "We have most of your details on file. Please fill in the few we're missing below."
            : "Your details are already on file, so there's nothing to fill in."}{" "}
          You&apos;ll pay by card on the next screen.
        </p>
        <button className="link-button" onClick={onReset}>
          Enter my details instead
        </button>
      </Notice>
    );
  }
  return (
    <div className="notice returning-panel">
      <Icon name="info" />
      <div className="notice-body">
        <p className="notice-title">Been to see us before?</p>
        {r.stage === "idle" && (
          <>
            <p>We can email you a code and use the details we already have, so you don&apos;t have to type them again.</p>
            <div>
              <button className="btn btn-secondary" onClick={() => setReturning({ ...r, stage: "open", error: null })}>
                Use my details on file
              </button>
            </div>
          </>
        )}
        {r.stage === "open" && (
          <form
            noValidate
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (r.email.includes("@")) onStart();
            }}
          >
            <div className="field">
              <label htmlFor="returning-email">Email you gave us</label>
              <input
                id="returning-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                value={r.email}
                onChange={(e) => setReturning({ ...r, email: e.target.value })}
              />
            </div>
            <button className="btn btn-secondary" type="submit" disabled={r.busy || !r.email.includes("@")}>
              {r.busy ? "Sending…" : "Email me a code"}
            </button>
          </form>
        )}
        {r.stage === "codeSent" && (
          <CodeEntry
            email={r.email}
            code={r.code}
            busy={r.busy}
            sentAt={r.sentAt}
            onChange={(code) => setReturning({ ...r, code })}
            onSubmit={onVerify}
            onResend={onStart}
            submitLabel="Continue"
            error={r.error}
            intro={
              <>
                We&apos;ve emailed a 6-digit code to <strong>{r.email}</strong>. Enter it to use the details we have on file. No email after a
                minute? Check your spam, or fill in your details below instead.
              </>
            }
          />
        )}
        {r.stage !== "idle" && (
          <button className="link-button" onClick={onReset}>
            {r.stage === "codeSent" ? "Use a different email" : "Cancel"}
          </button>
        )}
        {r.error && r.stage !== "codeSent" && (
          <p className="field-error" role="alert">
            <Icon name="alert" />
            <span>{r.error}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One field for a one-time code: paste and autofill allowed (WCAG 2.2
 * SC 3.3.8), no split boxes. Says where the code went; resend after 30s.
 */
export function CodeEntry({
  email,
  code,
  busy,
  sentAt,
  onChange,
  onSubmit,
  onResend,
  submitLabel,
  intro,
  error,
}: {
  error?: string | null;
  email: string;
  code: string;
  busy: boolean;
  sentAt: number | null;
  onChange: (code: string) => void;
  onSubmit: () => void;
  onResend: () => void;
  submitLabel: string;
  intro: ReactNode;
}) {
  const remaining = useCountdown(sentAt, 30);
  const digits = code.replace(/\D/g, "");
  // Continue is never greyed out (a disabled button doesn't say why): pressing it early explains instead.
  const [tooShort, setTooShort] = useState(false);
  const shownError = error ?? (tooShort ? "Enter all 6 digits of the code from your email." : null);
  // A full code (typed, pasted, or filled in from Mail/Messages/the keyboard)
  // is checked straight away: no extra tap. Each code is tried once, so a
  // wrong one isn't resent in a loop.
  const lastTried = useRef<string | null>(null);
  useEffect(() => {
    if (digits.length === 6 && !busy && lastTried.current !== digits) {
      lastTried.current = digits;
      onSubmit();
    }
  }, [digits, busy, onSubmit]);
  return (
    <div className="stack-3">
      <p>{intro}</p>
      <form
        noValidate
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (digits.length === 6) {
            lastTried.current = digits;
            onSubmit();
          } else {
            setTooShort(true);
            document.getElementById("otp")?.focus();
          }
        }}
      >
        <div className="field field-code">
          <label htmlFor="otp">6-digit code</label>
          {shownError && (
            <p className="field-error" id="otp-error" role="alert">
              <Icon name="alert" />
              <span>
                <span className="visually-hidden">Error: </span>
                {shownError}
              </span>
            </p>
          )}
          {/* One plain text field, so iOS/macOS (codes from Mail and Messages),
              Android keyboards and password managers can all fill it. No
              maxLength: a pasted "123 456" is cut to digits here instead. */}
          <input
            id="otp"
            name="one-time-code"
            type="text"
            className="input-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            autoFocus
            spellCheck={false}
            value={code}
            onChange={(e) => {
              setTooShort(false);
              onChange(e.target.value.replace(/\D/g, "").slice(0, 6));
            }}
            aria-invalid={!!shownError || undefined}
            aria-describedby={shownError ? "otp-error" : undefined}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Checking…" : submitLabel}
        </button>
      </form>
      <p className="secondary">
        {remaining > 0 ? (
          <>You can ask for a new code in {remaining} seconds.</>
        ) : (
          <button className="link-button" onClick={onResend} disabled={busy}>
            Send a new code to {email}
          </button>
        )}
      </p>
    </div>
  );
}

function useCountdown(since: number | null, seconds: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  if (!since) return 0;
  return Math.max(0, Math.ceil(seconds - (now - since) / 1000));
}

// ---------------------------------------------------------------- 5. Review and pay

export function ReviewStep({
  type,
  practitioner,
  startsAtISO,
  patient,
  savedCard,
  savedCardEmail,
  consent,
  setConsent,
  consentError,
  consentRef,
  privacy,
  setPrivacy,
  privacyError,
  privacyRef,
  marketing,
  setMarketing,
  submitting,
  payError,
  onPay,
  onChange,
  returnedFromStripe,
  headingRef,
  voucher,
}: {
  /** A gift voucher at checkout (v2); absent while VOUCHER_CHECKOUT is off. */
  voucher?: VoucherBox;
  type: AppointmentType;
  practitioner: Practitioner;
  startsAtISO: string;
  patient: Patient;
  savedCard: { brand: string; last4: string } | null;
  savedCardEmail: string;
  consent: boolean;
  setConsent: (v: boolean) => void;
  consentError: boolean;
  consentRef: RefObject<HTMLInputElement>;
  privacy: boolean;
  setPrivacy: (v: boolean) => void;
  privacyError: boolean;
  privacyRef: RefObject<HTMLInputElement>;
  marketing: boolean;
  setMarketing: (v: boolean) => void;
  submitting: boolean;
  payError: { message: string; slotGone?: boolean } | null;
  onPay: () => void;
  onChange: (step: Step) => void;
  returnedFromStripe: boolean;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  // The full fee, paid now (8 Oct 2026). Types without a price never reach this step.
  const fee = type.fullPriceEUR ?? 0;
  const fromVoucher = voucher?.applied ? voucher.applied.appliedMinor / 100 : 0;
  const dueNow = Math.round((fee - fromVoucher) * 100) / 100;
  const noCard = !!voucher?.applied && dueNow <= 0;
  const line = checkoutLineItem(type.name, startsAtISO);
  const payLabel = noCard ? "Book now" : savedCard ? `Pay ${eur(dueNow)} with card ending ${savedCard.last4}` : `Pay ${eur(dueNow)}`;

  return (
    <section>
      <div className="step-head">
        <p className="progress">Step 5 of 5</p>
        <h1 ref={headingRef} tabIndex={-1}>
          Review and pay
        </h1>
      </div>

      {returnedFromStripe && (
        <div className="block-gap">
          <Notice title="You didn't finish paying, so nothing has been charged">
            <p>Your choices are saved below. Check the time is still right, then pay when you&apos;re ready.</p>
          </Notice>
        </div>
      )}

      <div className="checkout">
        {/* Left: the summary, laid out like Stripe Checkout's */}
        <div className="checkout-summary">
          <div className="checkout-what">
            <h2>{line.name}</h2>
            <p className="tnum">{line.description}</p>
          </div>

          <dl className="summary-list">
            <div className="summary-row">
              <dt>Practitioner</dt>
              <dd className="checkout-who">
                <Avatar name={practitioner} url={practitioner.profilePictureUrl} small />
                <span>
                  {practitioner.firstName} {practitioner.lastName}
                </span>
              </dd>
              <dd className="summary-change">
                <button className="link-button" onClick={() => onChange(2)}>
                  Change<span className="visually-hidden"> practitioner</span>
                </button>
              </dd>
            </div>
            <div className="summary-row">
              <dt>When</dt>
              <dd className="tnum">
                {whenShort(startsAtISO)} · {type.durationMinutes} min
              </dd>
              <dd className="summary-change">
                <button className="link-button" onClick={() => onChange(3)}>
                  Change<span className="visually-hidden"> time</span>
                </button>
              </dd>
            </div>
            <div className="summary-row">
              <dt>Where</dt>
              <dd>
                Northbank, {CLINIC_ADDRESS}
                <br />
                <a className="secondary" href={CLINIC_MAP_URL} target="_blank" rel="noreferrer">
                  Open in maps<span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              </dd>
            </div>
            <div className="summary-row">
              <dt>Booking for</dt>
              <dd>
                {savedCard ? (
                  <>
                    Your patient record
                    <br />
                    <span className="secondary">{savedCardEmail}</span>
                  </>
                ) : (
                  <>
                    {patient.firstName} {patient.lastName}
                    <br />
                    <span className="secondary">{patient.email}</span>
                  </>
                )}
              </dd>
              <dd className="summary-change">
                <button className="link-button" onClick={() => onChange(4)}>
                  Change<span className="visually-hidden"> your details</span>
                </button>
              </dd>
            </div>
          </dl>

          {voucher && <VoucherField v={voucher} />}

          <dl className="line-items">
            <div>
              <dt>Appointment fee</dt>
              <dd>{eur(fee)}</dd>
            </div>
            {voucher?.applied && (
              <div>
                <dt>Gift voucher {voucher.applied.code}</dt>
                <dd>−{eur(fromVoucher)}</dd>
              </div>
            )}
            <div>
              <dt>To pay at the clinic</dt>
              <dd>{eur(0)}</dd>
            </div>
          </dl>
          <div className="amount-due">
            <span className="amount-due-label">Due now</span>
            <span className="amount">{eur(dueNow)}</span>
          </div>
          <p className="secondary extras-line">{EXTRAS_SENTENCE}</p>
        </div>

        {/* Right: the commitment */}
        <div className="checkout-commit">

          <div className="stack-2">
            <p className="policy-line">{POLICY_SENTENCE}</p>
            <p className="secondary">
              <a href="/cancellation-policy" target="_blank" rel="noreferrer">
                Read the cancellation policy<span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </p>
          </div>

          <div className="field">
            {consentError && (
              <p className="field-error" id="consent-error">
                <Icon name="alert" />
                <span>
                  <span className="visually-hidden">Error: </span>Tick the box to agree before you pay
                </span>
              </p>
            )}
            <label className="checkbox">
              <input
                ref={consentRef}
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                aria-invalid={consentError || undefined}
                aria-describedby={consentError ? "consent-error" : undefined}
              />
              <span>
                {noCard
                  ? "I agree to the cancellation policy."
                  : "I agree to the cancellation policy. I authorise Northbank to save my card securely with Stripe and charge it for extra treatment I agree to on the day, for future bookings I make, or under the cancellation policy."}
              </span>
            </label>
          </div>

          <div className="field consent-block">
            <p className="label" id="privacy-title">
              {PRIVACY_CONSENT_TITLE}
            </p>
            <p className="secondary" id="privacy-text">
              {PRIVACY_CONSENT_TEXT}{" "}
              <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                Read our privacy notice<span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </p>
            {privacyError && (
              <p className="field-error" id="privacy-error">
                <Icon name="alert" />
                <span>
                  <span className="visually-hidden">Error: </span>Tick &ldquo;I agree&rdquo; to the privacy and sharing of information before you pay
                </span>
              </p>
            )}
            <label className="checkbox">
              <input
                ref={privacyRef}
                type="checkbox"
                checked={privacy}
                onChange={(e) => setPrivacy(e.target.checked)}
                aria-invalid={privacyError || undefined}
                aria-describedby={["privacy-title", "privacy-text", privacyError ? "privacy-error" : ""].filter(Boolean).join(" ")}
              />
              <span>{PRIVACY_CONSENT_LABEL}</span>
            </label>
          </div>

          <div className="field consent-block">
            <label className="checkbox">
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} aria-describedby="marketing-hint" />
              <span>{MARKETING_OPT_IN_LABEL}</span>
            </label>
            <p className="secondary" id="marketing-hint">
              {MARKETING_OPT_IN_HINT}
            </p>
          </div>

          {payError && (
            <Notice
              tone="error"
              title={payError.slotGone ? "That time has just been taken" : "Payment didn't start"}
              actions={
                payError.slotGone ? (
                  <button className="btn btn-secondary" onClick={() => onChange(3)}>
                    Choose another time
                  </button>
                ) : undefined
              }
            >
              <p>{payError.message}</p>
            </Notice>
          )}

          <div className="stack-3">
            <button className="btn btn-primary btn-block" onClick={onPay} disabled={submitting}>
              {submitting ? (noCard ? "Booking…" : savedCard ? "Charging your card…" : "Opening secure payment…") : payLabel}
            </button>
            <p className="handoff">
              {noCard
                ? "Nothing to pay by card: your gift voucher covers it. We'll book it straight away."
                : savedCard
                  ? "We'll charge your saved card straight away. You won't need to enter it again."
                  : "Next, you'll pay on Stripe, our secure payment provider. You'll come straight back here."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- gift voucher at checkout (v2)

export type AppliedVoucherView = { code: string; appliedMinor: number; dueMinor: number; balanceMinor: number; expiresOn: string | null };
export type VoucherBox = {
  input: string;
  setInput: (s: string) => void;
  applied: AppliedVoucherView | null;
  applying: boolean;
  error: string | null;
  onApply: () => void;
  onRemove: () => void;
};

function VoucherField({ v }: { v: VoucherBox }) {
  if (v.applied) {
    const left = v.applied.balanceMinor - v.applied.appliedMinor;
    return (
      <div className="voucher-applied" role="status">
        <p>
          <strong>Gift voucher {v.applied.code}</strong>: {eur(v.applied.appliedMinor / 100)} off.
          {left > 0 ? ` ${eur(left / 100)} stays on it for next time.` : ""}
        </p>
        <button type="button" className="link-button" onClick={v.onRemove}>
          Remove<span className="visually-hidden"> gift voucher</span>
        </button>
      </div>
    );
  }
  return (
    <details className="voucher-box" open={!!v.input || !!v.error}>
      <summary>Have a gift voucher?</summary>
      <div className="field">
        <label htmlFor="voucher-code">Voucher code</label>
        <p className="field-hint" id="voucher-hint">
          It&apos;s on the voucher, like NB-7KQ4-X9TP-2HRM.
        </p>
        {v.error && (
          <p className="field-error" id="voucher-error">
            <Icon name="alert" />
            <span>
              <span className="visually-hidden">Error: </span>
              {v.error}
            </span>
          </p>
        )}
        <div className="voucher-row">
          <input
            id="voucher-code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={v.input}
            onChange={(e) => v.setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                v.onApply();
              }
            }}
            aria-invalid={!!v.error || undefined}
            aria-describedby={["voucher-hint", v.error ? "voucher-error" : ""].filter(Boolean).join(" ")}
          />
          <button type="button" className="btn btn-secondary" onClick={v.onApply} disabled={v.applying || !v.input.trim()}>
            {v.applying ? "Checking…" : "Apply"}
          </button>
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- summary pane

export function BookingSummary({
  step,
  type,
  practitioner,
  firstAvailable,
  startsAtISO,
  patientName,
  onChange,
  bare = false,
}: {
  bare?: boolean;
  step: Step;
  type: AppointmentType | null;
  practitioner: Practitioner | null;
  firstAvailable: boolean;
  startsAtISO: string | null;
  patientName: string | null;
  onChange: (step: Step) => void;
}) {
  const row = (label: string, value: ReactNode, target: Step, show: boolean) => (
    <div className="summary-row">
      <dt>{label}</dt>
      <dd>{show ? value : <span className="summary-empty">Not chosen yet</span>}</dd>
      {show && step > target && (
        <dd className="summary-change">
          <button className="link-button" onClick={() => onChange(target)}>
            Change<span className="visually-hidden"> {label.toLowerCase()}</span>
          </button>
        </dd>
      )}
    </div>
  );
  const list = (
      <dl className="summary-list">
        {row(
          "Treatment",
          type && (
            <>
              {type.name}
              <br />
              <span className="secondary tnum">{priceFacts(type)}</span>
            </>
          ),
          1,
          !!type
        )}
        {row(
          "Practitioner",
          practitioner && (
            <>
              {practitioner.firstName} {practitioner.lastName}
              {firstAvailable && <span className="secondary"> (first available)</span>}
            </>
          ),
          2,
          !!practitioner
        )}
        {row("Time", startsAtISO && <span className="tnum">{whenShort(startsAtISO)}</span>, 3, !!startsAtISO && step > 3)}
        {row("Your details", patientName, 4, !!patientName && step > 4)}
      </dl>
  );
  if (bare) return list;
  return (
    <div className="summary-panel">
      <h2>Your booking</h2>
      {list}
      <p className="secondary summary-policy">{POLICY_SENTENCE}</p>
    </div>
  );
}

export function MobileSummary(props: Parameters<typeof BookingSummary>[0]) {
  const { type, practitioner, startsAtISO, step } = props;
  if (!type) return null;
  const bits = [type.name, practitioner && `${practitioner.firstName} ${practitioner.lastName}`, step > 3 && startsAtISO && whenShort(startsAtISO)].filter(Boolean);
  return (
    <details className="mobile-summary flow-mobile-only">
      <summary>
        <span className="mobile-summary-label">Your booking</span>
        <span className="mobile-summary-text">{bits.join(" · ")}</span>
        <Icon name="chevron-down" className="icon mobile-summary-icon" />
      </summary>
      <div className="mobile-summary-body">
        <BookingSummary {...props} bare />
      </div>
    </details>
  );
}

export { PhoneLink };
