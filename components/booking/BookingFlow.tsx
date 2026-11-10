"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { waitlistOn } from "@/core/waitlist-switch";
import { BackToDashboard } from "@/components/dashboard/BackToDashboard";
import { addDays, dublinDay, lastOnlineBookingDay, ONLINE_BOOKING_WEEKS_AHEAD, CLINIC_PHONE, CLINIC_TEL } from "@/core/policy";
import { dayLabel, mondayOf, whenShort } from "@/core/format";
import { isIrishOrIntlMobile, isPlausibleDateOfBirth, type GapField } from "@/core/patient-details";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import ReceptionPayStep from "@/components/booking/ReceptionPayStep";
import PatientLookup, { visitLine, type ChosenPatient } from "@/components/booking/PatientLookup";
import {
  BookingSummary,
  DetailsStep,
  HEARD_ABOUT_US_OPTIONS,
  MobileSummary,
  PractitionerStep,
  ReviewStep,
  TimeStep,
  TreatmentStep,
  areaOf,
  type AppliedVoucherView,
  type FieldErrors,
  type WeekDay,
} from "@/components/booking/Steps";
import { kindOfType, typesFor, type PatientKind } from "@/core/patient-kind";
import { browserStore, clearPhoneDraft, readPhoneDraft, savePhoneDraft } from "@/core/phone-draft";
import {
  EMPTY_PATIENT,
  STEP_TITLES,
  readDraft,
  saveDraft,
  type AppointmentType,
  type Patient,
  type Practitioner,
  type ReturningState,
  type Step,
} from "@/components/booking/types";

/**
 * Patient booking: five calm steps (treatment, practitioner, time, details,
 * review and pay). One screen per step on mobile, two panes on desktop.
 *
 * Reception uses the same steps to book a patient over the phone
 * (/admin/book, `reception` set): no saved-card shortcut on step 4, and
 * step 5 sends a payment link or takes the card over the phone
 * (ReceptionPayStep) instead of opening Stripe here. A therapist booking
 * their own patient (`reception.practitionerId` set) only sees themselves on
 * step 2, and pays by link only. Signed in on the dashboard
 * (`reception.userId` set), a booking in progress is remembered in this tab
 * until the payment link is made (core/phone-draft.ts). Reception and owners
 * can find the caller in Cliniko first (PatientLookup): their last treatment
 * and therapist are suggested, step 4 is filled from their record, and the
 * booking is made on that record.
 *
 * Presentation only: the requests, the payload sent to /api/checkout and
 * /api/charge-returning-patient, and every server-side rule are unchanged
 * from the pre-redesign flow. The server still recomputes every amount.
 */

// Optional manual override for when there's more than one Cliniko business —
// leave unset and the app will use whichever business Cliniko returns first.
const BUSINESS_ID_OVERRIDE = process.env.NEXT_PUBLIC_DEFAULT_BUSINESS_ID || null;

// How far ahead the week strip can go: ONLINE_BOOKING_WEEKS_AHEAD (core/policy.ts),
// the same as Cliniko's "Offer bookings up to 12 weeks ahead", which decides what's bookable.

// ---- Dev-only test data ----
// Only referenced behind `process.env.NODE_ENV !== "production"`, which
// Next.js inlines at build time — so `next build` (every Vercel deploy,
// previews included) strips the button that uses this entirely.
function randomTestPatient(): Patient {
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  const firstName = pick(["Aoife", "Ciara", "Sean", "Niamh", "Conor", "Orla", "Darragh", "Saoirse"]);
  const lastName = pick(["Test-Byrne", "Test-Kelly", "Test-Walsh", "Test-Doyle", "Test-Ryan"]);
  const n = Math.floor(Math.random() * 100000);
  const year = 1960 + Math.floor(Math.random() * 45);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
  return {
    firstName,
    lastName,
    email: `test+${n}@example.com`,
    phone: `08${Math.floor(10000000 + Math.random() * 89999999)}`,
    dateOfBirth: `${year}-${month}-${day}`,
    address: `${1 + Math.floor(Math.random() * 200)} Test Road, Dublin 2`,
    county: "Dublin",
    eircode: "D02 XY12",
    referredBy: "",
    gpName: `Dr. ${pick(["Murphy", "O'Brien", "Byrne"])} (test)`,
    heardAboutUs: pick(HEARD_ABOUT_US_OPTIONS),
  };
}

const todayDublin = () => dublinDay(new Date().toISOString());

/**
 * History state for a step, keeping Next.js's own keys (`__NA` and the
 * router tree). Without them Next treats Back as a foreign entry and
 * reloads the page, which wiped every choice the patient had made.
 */
let nextJsKeys: Record<string, unknown> = {};
function historyState(own: { clinicStep: Step; area?: string | null }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { clinicStep, area, ...rest } = (window.history.state ?? {}) as Record<string, unknown>;
  // The skip link or an error link can leave an entry with no state at all:
  // keep the last keys Next.js set, so later entries still carry them.
  if (rest.__NA) nextJsKeys = rest;
  return { ...nextJsKeys, ...own };
}
/** A phone booking in progress (core/phone-draft.ts): the choices and the details typed so far. Never card details. */
type PhoneDraft = {
  step: Step;
  area: string | null;
  patientKind: PatientKind | null;
  type: AppointmentType | null;
  practitioner: Practitioner | null;
  firstAvailable: boolean;
  startsAtISO: string | null;
  businessId: string | null;
  patient: Patient;
  chosen?: ChosenPatient | null;
};

const EMPTY_RETURNING: ReturningState = { stage: "idle", email: "", code: "", token: null, card: null, missing: [], busy: false, error: null, sentAt: null };

/**
 * Every detail is asked on every booking (8 Oct 2026). `only`: a returning
 * patient paying with their saved card is checked just for what their record
 * lacks. The server checks the same rules (lib/schemas.ts).
 */
function validate(p: Patient, only?: GapField[]): FieldErrors {
  const e: FieldErrors = {};
  const asks = (f: GapField) => !only || only.includes(f);
  if (!only) {
    if (!p.firstName.trim()) e.firstName = "Enter your first name";
    if (!p.lastName.trim()) e.lastName = "Enter your last name";
    if (!p.email.trim()) e.email = "Enter your email address";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) e.email = "Enter an email address like name@example.com";
  }
  if (asks("phone")) {
    if (!p.phone.trim()) e.phone = "Enter your mobile number";
    else if (!isIrishOrIntlMobile(p.phone)) e.phone = "Enter a mobile number like 087 123 4567";
  }
  if (asks("dateOfBirth")) {
    const [y = "", m = "", d = ""] = p.dateOfBirth ? p.dateOfBirth.split("-") : [];
    if (!p.dateOfBirth) e.dateOfBirth = "Enter your date of birth";
    else if (!d || !m || !y) e.dateOfBirth = "Your date of birth must include a day, month and year";
    else if (y.length !== 4) e.dateOfBirth = "Enter the year in full, like 1958";
    else if (!isPlausibleDateOfBirth(normaliseDateOfBirth(p.dateOfBirth))) e.dateOfBirth = "Enter a real date of birth, like 2 4 1958";
  }
  if (asks("address") && !p.address.trim()) e.address = "Enter your address";
  if (asks("gpName") && !p.gpName.trim()) e.gpName = "Enter your GP's name, or \u201cNone\u201d";
  // "How did you hear about us?" is optional (review, 15 Oct).
  return e;
}

/** "1958-4-2" as typed in the three boxes \u2192 "1958-04-02". Anything else is left as it is. */
function normaliseDateOfBirth(v: string) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : v;
}

/** The answers a returning patient gave for the gaps in their record (and the fields that go with them). */
function gapAnswers(p: Patient, missing: GapField[]) {
  const out: Record<string, string> = {};
  const put = (k: keyof Patient) => {
    if (p[k].trim()) out[k] = p[k].trim();
  };
  if (missing.includes("phone")) put("phone");
  if (missing.includes("dateOfBirth")) put("dateOfBirth");
  if (missing.includes("address")) ["address", "county", "eircode"].forEach((k) => put(k as keyof Patient));
  if (missing.includes("gpName")) put("gpName");
  if (missing.includes("heardAboutUs")) ["heardAboutUs", "referredBy"].forEach((k) => put(k as keyof Patient));
  return out;
}

export default function BookingFlow({ reception }: { reception?: { adminKey: string; practitionerId?: string; userId?: string } } = {}) {
  const onlyPractitioner = reception?.practitionerId ?? null;
  const draftUser = reception?.userId ?? null;
  // Find a patient in Cliniko: reception and owners on the dashboard, not therapists (core/patient-lookup.ts).
  const lookupOn = !!reception && !reception.adminKey && !reception.practitionerId;
  // Signed in on the dashboard (not the old shared-key page): keep the way back on every step.
  const onDashboard = !!reception && !reception.adminKey;
  const [step, setStep] = useState<Step>(1);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const focusOnStep = useRef(false);

  // ---- Business / location ----
  const [businessId, setBusinessId] = useState<string | null>(BUSINESS_ID_OVERRIDE);
  const [businessError, setBusinessError] = useState<string | null>(null);

  // ---- Step 1: treatment ----
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<AppointmentType | null>(null);
  // Step 1 is area first (Physiotherapy, Massage, …), then the appointment.
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  // New or returning patient, asked before the treatments (core/patient-kind.ts).
  const [patientKind, setPatientKind] = useState<PatientKind | null>(null);

  // ---- Step 2: practitioner ----
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [practitionersLoading, setPractitionersLoading] = useState(false);
  const [practitionersError, setPractitionersError] = useState<string | null>(null);
  const [selectedPractitioner, setSelectedPractitioner] = useState<Practitioner | null>(null);
  // "First available" = the soonest practitioner, with their earliest slot
  // picked for the patient as soon as their times load.
  const [firstAvailableChosen, setFirstAvailableChosen] = useState(false);
  const autoPickFirstTime = useRef(false);

  // ---- Step 3: time ----
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(todayDublin()));
  const [timesByWeek, setTimesByWeek] = useState<Record<string, string[]>>({});
  const [timesLoading, setTimesLoading] = useState(false);
  const [timesError, setTimesError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [timeNotice, setTimeNotice] = useState<string | null>(null);
  const [timesNonce, setTimesNonce] = useState(0); // bump to re-check a week after "slot taken"

  // ---- Step 4: details ----
  const [patient, setPatient] = useState<Patient>(EMPTY_PATIENT);
  // The caller, picked in the patient lookup: the booking is made on this Cliniko record.
  const [chosenPatient, setChosenPatient] = useState<ChosenPatient | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Returning patients: email → emailed code → pay with the saved card,
  // skipping the details form and Stripe Checkout.
  const [returning, setReturning] = useState<ReturningState>(EMPTY_RETURNING);
  const payingWithSavedCard = returning.stage === "verified" && !!returning.token;

  // ---- Step 5: review and pay ----
  // Everyone pays the full fee when they book (8 Oct 2026): no choice to make.
  // Wording covers the cancellation policy AND keeping the card for
  // late-cancellation/no-show charges — that consent is what allows
  // charging the saved card later without the patient present.
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [consentError, setConsentError] = useState(false);
  // Separate from the cancellation policy: "I've read the privacy notice".
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [privacyError, setPrivacyError] = useState(false);
  // Optional newsletter box, unticked by default (core/mailerlite.ts).
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  // Gift voucher at checkout (v2): only for patients booking themselves, and only once switched on.
  const [voucherOn, setVoucherOn] = useState(false);
  const [voucherInput, setVoucherInput] = useState("");
  const [voucherApplied, setVoucherApplied] = useState<AppliedVoucherView | null>(null);
  const [voucherApplying, setVoucherApplying] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  useEffect(() => {
    if (reception) return;
    fetch("/api/vouchers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setVoucherOn(!!d.checkoutOn))
      .catch(() => setVoucherOn(false));
  }, [reception]);
  // A different treatment means a different fee: check the voucher again.
  useEffect(() => {
    setVoucherApplied(null);
  }, [selectedType?.id]);
  async function applyVoucher() {
    if (!selectedType || !voucherInput.trim()) return;
    setVoucherApplying(true);
    setVoucherError(null);
    try {
      const res = await fetch("/api/vouchers/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: voucherInput, appointmentTypeId: selectedType.id }) });
      const d = await res.json().catch(() => ({}));
      if (d.ok) {
        setVoucherApplied({ code: d.code, appliedMinor: d.appliedMinor, dueMinor: d.dueMinor, balanceMinor: d.balanceMinor, expiresOn: d.expiresOn });
        setVoucherInput("");
      } else setVoucherError(d.message ?? `We couldn't check that voucher. Please try again, or call us on ${CLINIC_PHONE}.`);
    } catch {
      setVoucherError("We couldn't check that voucher. Please check your connection and try again.");
    }
    setVoucherApplying(false);
  }
  const voucherBody = voucherApplied ? { voucher: { code: voucherApplied.code, appliedMinor: voucherApplied.appliedMinor } } : {};
  /** The server said the voucher changed or can't be used: show why on the voucher box, take it off. */
  function voucherProblem(message: string) {
    setVoucherApplied(null);
    setVoucherError(message);
  }
  const privacyRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<{ message: string; slotGone?: boolean } | null>(null);
  const [returnedFromStripe, setReturnedFromStripe] = useState(false);

  // ---- Kill switch ----
  const [pausedMessage, setPausedMessage] = useState<string | null>(null);
  // Emergency redirect (lib/flags.ts): owners have sent patients to Cliniko's own booking page.
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  const timesKey = selectedPractitioner && selectedType ? `${selectedPractitioner.id}:${selectedType.id}:${weekStart}` : null;
  const weekTimes = timesKey ? timesByWeek[timesKey] : undefined;

  // ---- A phone booking in progress (core/phone-draft.ts) ----
  // Offered back on opening the page; nothing is saved until staff carry on or start again.
  const [resumeOffer, setResumeOffer] = useState<PhoneDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const draftDone = useRef(false);

  // ------------------------------------------------------------ navigation

  const goTo = useCallback((next: Step, opts: { replace?: boolean; area?: string | null } = {}) => {
    setStep(next);
    focusOnStep.current = true;
    try {
      const state = historyState(opts.area !== undefined ? { clinicStep: next, area: opts.area } : { clinicStep: next });
      if (opts.replace) window.history.replaceState(state, "");
      else window.history.pushState(state, "");
    } catch {}
  }, []);

  // Browser Back/Forward moves between steps instead of leaving the page.
  useEffect(() => {
    try {
      window.history.replaceState(historyState({ clinicStep: 1 }), "");
    } catch {}
    const onPop = (e: PopStateEvent) => {
      // A same-page link (#firstName in the error summary, #main) adds an
      // entry with no step: that's not a step change, so stay put. It used
      // to send the patient back to step 1.
      if (typeof e.state?.clinicStep !== "number") return;
      const s = e.state.clinicStep as Step;
      setStep(s);
      if (e.state && "area" in e.state) setSelectedArea(e.state.area ?? null);
      else if (s === 1) setSelectedArea(null);
      focusOnStep.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Back and "Change" links: returning to step 1 opens the chosen treatment's area.
  function goToStep(s: Step) {
    if (s === 1) {
      const area = selectedType ? areaOf(selectedType) : null;
      setSelectedArea(area);
      goTo(1, { area });
    } else goTo(s);
  }

  function chooseKind(k: PatientKind) {
    if (k === patientKind) return;
    setPatientKind(k);
    setSelectedArea(null);
    if (k !== "returning" && patientKind !== "returning") return; // new and last-seen-6+-months see the same treatments
    // A treatment picked for the other kind of patient no longer applies.
    const chosen = selectedType ? kindOfType(selectedType.name) : null;
    if (chosen && chosen !== (k === "returning" ? "returning" : "new")) {
      setSelectedType(null);
      setSelectedPractitioner(null);
      setFirstAvailableChosen(false);
      setSelectedTime(null);
      autoPickFirstTime.current = false;
    }
  }

  function chooseArea(area: string | null) {
    setSelectedArea(area);
    focusOnStep.current = true;
    try {
      window.history.pushState(historyState({ clinicStep: 1, area }), "");
    } catch {}
  }

  // Never show a step whose earlier choices are missing (e.g. Forward after a Change).
  const reachable: Step = !selectedType ? 1 : !selectedPractitioner ? 2 : !selectedTime ? 3 : step >= 5 && (payingWithSavedCard || patient.firstName) ? 5 : 4;
  const shownStep: Step = (Math.min(step, reachable) as Step) || 1;

  // Move focus to the new step's heading so screen readers announce it.
  useEffect(() => {
    if (!focusOnStep.current) return;
    focusOnStep.current = false;
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [shownStep, selectedArea]);

  useEffect(() => {
    document.title = `${STEP_TITLES[shownStep]} · ${reception ? "Phone booking" : "Book an appointment"} · Northbank`;
  }, [shownStep, reception]);

  // A booking in progress from earlier in this tab: offer it back before anything else.
  useEffect(() => {
    if (!draftUser) return;
    const d = readPhoneDraft<PhoneDraft>(browserStore(), draftUser);
    if (d && d.step >= 1 && d.step <= 5 && d.patient) setResumeOffer(d);
    else setDraftReady(true);
  }, [draftUser]);

  // Remember each choice and the details typed so far, until the payment link is made.
  useEffect(() => {
    if (!draftUser || !draftReady || draftDone.current) return;
    if (!patientKind && !selectedType) return;
    savePhoneDraft<PhoneDraft>(browserStore(), draftUser, {
      step: shownStep,
      area: selectedArea,
      patientKind,
      type: selectedType,
      practitioner: selectedPractitioner,
      firstAvailable: firstAvailableChosen,
      startsAtISO: selectedTime,
      businessId,
      patient,
      chosen: chosenPatient,
    });
  }, [draftUser, draftReady, shownStep, selectedArea, patientKind, selectedType, selectedPractitioner, firstAvailableChosen, selectedTime, businessId, patient, chosenPatient]);

  // ------------------------------------------------------------ data

  // Kill switch: if the clinic has paused online booking, say so up front.
  useEffect(() => {
    fetch("/api/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setPausedMessage(d.onlineBooking === false ? d.message : null);
        setRedirectUrl(d.onlineBooking === false && typeof d.redirectUrl === "string" ? d.redirectUrl : null);
      })
      .catch(() => {});
  }, []);

  // Step 1: every online-bookable appointment type in the clinic, loaded once.
  useEffect(() => {
    setTypesLoading(true);
    fetch(onDashboard ? "/api/appointment-types?staff=1" : "/api/appointment-types")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          console.error("Appointment types:", d.error);
          setTypesError(d.error);
        } else setAppointmentTypes(d.appointmentTypes ?? []);
      })
      .catch(() => setTypesError("unreachable"))
      .finally(() => setTypesLoading(false));
  }, []);

  // Resolve the business/location automatically from Cliniko unless overridden.
  useEffect(() => {
    if (BUSINESS_ID_OVERRIDE) return;
    fetch("/api/businesses")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setBusinessError(d.error);
        else if (d.businesses?.[0]?.id) setBusinessId(d.businesses[0].id);
        else setBusinessError("No business/location found in Cliniko.");
      })
      .catch(() => setBusinessError("Could not reach Cliniko to find the business/location."));
  }, []);

  // Step 2: only the practitioners Cliniko says offer the chosen type, each
  // with their earliest slot as a preview.
  const typeId = selectedType?.id ?? null;
  useEffect(() => {
    setPractitioners([]);
    setPractitionersError(null);
    if (!typeId || !businessId) return;
    let cancelled = false; // drop responses for a type the patient has since changed
    setPractitionersLoading(true);
    fetch(`/api/practitioners?appointmentTypeId=${typeId}&businessId=${businessId}${onDashboard ? "&staff=1" : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setPractitionersError(d.error);
        else setPractitioners(((d.practitioners ?? []) as Practitioner[]).filter((p) => !onlyPractitioner || String(p.id) === onlyPractitioner));
      })
      .catch(() => !cancelled && setPractitionersError("Could not reach Cliniko to load clinicians."))
      .finally(() => !cancelled && setPractitionersLoading(false));
    return () => {
      cancelled = true;
    };
  }, [typeId, businessId, onlyPractitioner]);

  // Step 3: one week (Mon–Sun) of times for the chosen practitioner + type.
  // Cliniko rejects any from/to span over 7 days, and rejects a "from" in
  // the past, so the first week starts today (Irish date, not UTC).
  const practitionerId = selectedPractitioner?.id ?? null;
  useEffect(() => {
    setTimesError(null);
    if (!practitionerId || !typeId || !businessId || !timesKey) return;
    if (timesByWeek[timesKey]) return; // already loaded
    const today = todayDublin();
    const from = weekStart < today ? today : weekStart;
    const to = addDays(weekStart, 6);
    if (to < from) {
      setTimesByWeek((m) => ({ ...m, [timesKey]: [] }));
      return;
    }
    let cancelled = false;
    setTimesLoading(true);
    fetch(
      `/api/available-times?businessId=${businessId}&practitionerId=${practitionerId}&appointmentTypeId=${typeId}&from=${from}&to=${to}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) {
          console.error("Available times:", d.error);
          setTimesError(d.error);
          return;
        }
        const times: string[] = (d.availableTimes ?? []).map((t: any) => t.appointment_start).sort();
        setTimesByWeek((m) => ({ ...m, [timesKey]: times }));
      })
      .catch(() => !cancelled && setTimesError("Could not reach Cliniko to check availability."))
      .finally(() => !cancelled && setTimesLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timesKey, timesNonce]);

  // When a week's times arrive, pick a day (and, for "first available", the time).
  useEffect(() => {
    if (!weekTimes) return;
    const daysWithTimes = [...new Set(weekTimes.map((t) => dublinDay(t)))];
    if (autoPickFirstTime.current && weekTimes.length > 0) {
      autoPickFirstTime.current = false;
      setSelectedTime(weekTimes[0]);
      setSelectedDay(dublinDay(weekTimes[0]));
      return;
    }
    setSelectedDay((d) => (d && daysWithTimes.includes(d) ? d : daysWithTimes[0] ?? null));
  }, [weekTimes]);

  const days: WeekDay[] = useMemo(() => {
    const today = todayDublin();
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      const count = (weekTimes ?? []).filter((t) => dublinDay(t) === day).length;
      return { day, count, past: day < today };
    });
  }, [weekStart, weekTimes]);

  const daySlots = useMemo(() => (weekTimes ?? []).filter((t) => selectedDay && dublinDay(t) === selectedDay), [weekTimes, selectedDay]);

  // ------------------------------------------------------------ choices

  function chooseType(t: AppointmentType) {
    if (selectedType?.id !== t.id) {
      setSelectedType(t);
      setSelectedPractitioner(null);
      setFirstAvailableChosen(false);
      setSelectedTime(null);
      autoPickFirstTime.current = false;
    }
    goTo(2);
  }

  function openWeekFor(iso: string | null) {
    const day = iso ? dublinDay(iso) : todayDublin();
    setWeekStart(mondayOf(day));
    setSelectedDay(iso ? day : null);
  }

  function choosePractitioner(p: Practitioner) {
    if (selectedPractitioner?.id !== p.id || firstAvailableChosen) {
      setSelectedTime(null);
      openWeekFor(p.nextAvailableISO);
    }
    setFirstAvailableChosen(false);
    autoPickFirstTime.current = false;
    setSelectedPractitioner(p);
    setTimeNotice(null);
    goTo(3);
  }

  function chooseFirstAvailable() {
    const first = practitioners.find((p) => p.nextAvailableISO);
    if (!first) return;
    setFirstAvailableChosen(true);
    setSelectedPractitioner(first);
    openWeekFor(first.nextAvailableISO);
    const key = selectedType ? `${first.id}:${selectedType.id}:${mondayOf(dublinDay(first.nextAvailableISO!))}` : "";
    const loaded = timesByWeek[key];
    if (loaded?.length) {
      setSelectedTime(loaded[0]);
      setSelectedDay(dublinDay(loaded[0]));
    } else {
      setSelectedTime(null);
      autoPickFirstTime.current = true;
    }
    setTimeNotice(null);
    goTo(3);
  }

  // The chosen time only stays chosen while its own day is on screen.
  // Otherwise the bar kept saying "Fri 16 Oct, 11:45am" while another day
  // was highlighted, and Continue booked the old time (review, 15 Oct).
  function selectDay(day: string) {
    setSelectedDay(day);
    if (selectedTime && dublinDay(selectedTime) !== day) setSelectedTime(null);
  }

  function changeWeek(delta: number) {
    const next = addDays(weekStart, delta * 7);
    setWeekStart(next);
    const chosenDay = selectedTime ? dublinDay(selectedTime) : null;
    if (chosenDay && chosenDay >= next && chosenDay <= addDays(next, 6)) setSelectedDay(chosenDay);
    else {
      setSelectedTime(null);
      setSelectedDay(null);
    }
  }

  function jumpTo(day: string) {
    const today = todayDublin();
    const last = lastOnlineBookingDay(today);
    if (day > last) {
      // Past Cliniko's online limit there are no times at all: say so instead of an empty week.
      setTimeNotice(
        `We take bookings online up to ${ONLINE_BOOKING_WEEKS_AHEAD} weeks ahead, so the last day you can book is ${dayLabel(last).full}. For a later date, please call us on ${CLINIC_PHONE}.`
      );
      day = last;
    } else setTimeNotice(null);
    const target = day < today ? today : day;
    setWeekStart(mondayOf(target));
    setSelectedDay(target);
    if (selectedTime && dublinDay(selectedTime) !== target) setSelectedTime(null);
  }

  function continueFromTime() {
    if (!selectedTime) {
      setTimeNotice("Choose a time to continue.");
      return;
    }
    setTimeNotice(null);
    goTo(4);
  }

  function continueFromDetails() {
    const p = { ...patient, dateOfBirth: normaliseDateOfBirth(patient.dateOfBirth) };
    if (p.dateOfBirth !== patient.dateOfBirth) setPatient(p);
    const errors = payingWithSavedCard ? validate(p, returning.missing) : validate(p);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setTimeout(() => errorSummaryRef.current?.focus(), 0);
      return;
    }
    goTo(5);
  }

  // ------------------------------------------------------------ booking in progress

  /** Carry on: the time is checked again first. Taken since? Keep the details and choose another time. */
  async function carryOn() {
    const d = resumeOffer;
    if (!d) return;
    setResumeBusy(true);
    let taken: string | null = null;
    let unchecked: string | null = null;
    if (d.startsAtISO && d.type && d.practitioner) {
      const when = whenShort(d.startsAtISO);
      try {
        const res = await fetch("/api/admin/slot-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId: d.businessId, practitionerId: d.practitioner.id, appointmentTypeId: d.type.id, startsAtISO: d.startsAtISO }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || typeof data.available !== "boolean") unchecked = `We couldn't check that ${when} is still free. Choose the time again. The patient's details are kept.`;
        else if (!data.available) taken = `${when} has been booked since you started. Choose another time. The patient's details are kept.`;
      } catch {
        unchecked = `We couldn't check that ${when} is still free. Choose the time again. The patient's details are kept.`;
      }
    }
    const lostTime = !!(taken || unchecked);
    setPatientKind(d.patientKind);
    setSelectedType(d.type);
    setSelectedArea(d.type ? areaOf(d.type) : d.area);
    setSelectedPractitioner(d.practitioner);
    setFirstAvailableChosen(d.firstAvailable);
    const future = d.startsAtISO && Date.parse(d.startsAtISO) > Date.now() ? d.startsAtISO : null;
    openWeekFor(future);
    setSelectedTime(lostTime ? null : d.startsAtISO);
    setPatient({ ...EMPTY_PATIENT, ...d.patient });
    setChosenPatient(d.chosen ?? null);
    if (taken) setPayError({ message: taken, slotGone: true });
    if (unchecked) setTimeNotice(unchecked);
    setResumeOffer(null);
    setResumeBusy(false);
    setDraftReady(true);
    const step: Step = lostTime ? 3 : d.step;
    goTo(step, { replace: true, ...(step === 1 ? { area: d.area } : {}) });
  }

  function startAgain() {
    if (draftUser) clearPhoneDraft(browserStore(), draftUser);
    setResumeOffer(null);
    setDraftReady(true);
  }

  /** The payment link is made (or the card taken): forget the booking in progress. */
  const finishDraft = useCallback(() => {
    draftDone.current = true;
    if (draftUser) clearPhoneDraft(browserStore(), draftUser);
  }, [draftUser]);

  // ------------------------------------------------------------ patient lookup

  /** Picked in Cliniko: their details fill step 4, and new / returning is suggested from their last visit. */
  function choosePatient(c: ChosenPatient) {
    setChosenPatient(c);
    setPatient({ ...EMPTY_PATIENT, ...c.prefill });
    setFieldErrors({});
    if (c.suggestedKind) chooseKind(c.suggestedKind);
  }

  function forgetPatient() {
    setChosenPatient(null);
    setPatient(EMPTY_PATIENT);
    setFieldErrors({});
  }

  const lastVisit = chosenPatient?.last ?? null;
  const lastType = lastVisit?.appointmentTypeId ? appointmentTypes.find((t) => String(t.id) === lastVisit.appointmentTypeId) ?? null : null;
  // Only offered when it's bookable online and fits new / returning as chosen.
  const sameTypeAgain = lastType && (!patientKind || typesFor([lastType], patientKind).length) ? lastType : null;
  const lastPractitioner = lastVisit?.practitionerId ? practitioners.find((p) => String(p.id) === lastVisit.practitionerId) ?? null : null;

  // ------------------------------------------------------------ returning patient

  async function startReturningLookup() {
    setReturning((r) => ({ ...r, busy: true, error: null }));
    try {
      const res = await fetch("/api/returning-patient/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: returning.email }),
      });
      const data = await res.json();
      if (data.error) setReturning((r) => ({ ...r, busy: false, error: data.message ?? data.error }));
      else setReturning((r) => ({ ...r, busy: false, stage: "codeSent", code: "", sentAt: Date.now() }));
    } catch {
      // Treat like "no match" — the details form is right there.
      setReturning((r) => ({ ...r, busy: false, stage: "codeSent", code: "", sentAt: Date.now() }));
    }
  }

  async function verifyReturningCode() {
    setReturning((r) => ({ ...r, busy: true, error: null }));
    try {
      const res = await fetch("/api/returning-patient/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: returning.email, code: returning.code.replace(/\D/g, "") }),
      });
      const data = await res.json();
      if (data.token) {
        setFieldErrors({});
        setReturning((r) => ({ ...r, busy: false, stage: "verified", token: data.token, card: data.card, missing: data.missing ?? [] }));
      } else if (data.noSavedCard) {
        // Code was right but the card has gone: close the code box, keep the form.
        resetReturning(data.error);
      } else setReturning((r) => ({ ...r, busy: false, error: data.message ?? data.error ?? "That code didn't work. Check it and try again." }));
    } catch {
      setReturning((r) => ({ ...r, busy: false, error: "We couldn't check that code. Please try again." }));
    }
  }

  function resetReturning(error: string | null = null) {
    setReturning({ ...EMPTY_RETURNING, error });
  }

  // ------------------------------------------------------------ pay

  // Display only — the server looks the real amount up from Cliniko.
  const amountEUR = selectedType?.fullPriceEUR ?? 0;

  // The chosen time was taken while the patient was deciding: forget the
  // cached week, re-check it, and take them back to step 3 with the reason.
  function slotGone() {
    if (timesKey)
      setTimesByWeek((m) => {
        const next = { ...m };
        delete next[timesKey];
        return next;
      });
    setTimesNonce((n) => n + 1);
    setSelectedTime(null);
    goTo(3);
  }

  function rememberDraft() {
    if (!selectedType || !selectedPractitioner || !selectedTime) return;
    saveDraft({
      v: 1,
      type: selectedType,
      practitioner: selectedPractitioner,
      firstAvailable: firstAvailableChosen,
      startsAtISO: selectedTime,
      paymentOption: "full",
      amountEUR,
      ...(voucherApplied ? { voucherEUR: voucherApplied.appliedMinor / 100 } : {}),
      patient: { firstName: patient.firstName, lastName: patient.lastName, email: patient.email, phone: patient.phone },
      patientKind,
    });
  }

  async function handlePay() {
    setConsentError(!policyAccepted);
    setPrivacyError(!privacyAcknowledged);
    if (!policyAccepted || !privacyAcknowledged) {
      (!policyAccepted ? consentRef : privacyRef).current?.focus();
      return;
    }
    if (payingWithSavedCard) return handleChargeSavedCard();
    return handleCheckout();
  }

  async function handleChargeSavedCard() {
    if (!selectedPractitioner || !selectedType || !selectedTime || !returning.token) return;
    setSubmitting(true);
    setPayError(null);
    try {
      const res = await fetch("/api/charge-returning-patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: returning.token,
          practitionerId: selectedPractitioner.id,
          appointmentTypeId: selectedType.id,
          businessId,
          startsAtISO: selectedTime,
          paymentOption: "full",
          currency: "eur",
          visit: patientKind ?? undefined,
          policyAccepted,
          privacyAcknowledged,
          marketingOptIn,
          ...voucherBody,
          details: gapAnswers({ ...patient, dateOfBirth: normaliseDateOfBirth(patient.dateOfBirth) }, returning.missing),
        }),
      });
      const data = await res.json();
      if (data.status === "succeeded" && !data.bookingError) {
        rememberDraft();
        window.location.href = "/booking/confirmed?booked=1";
      } else if (data.status === "succeeded" && data.refunded) {
        setPayError({
          message: `We couldn't finish the booking, so your payment has been refunded in full. Please choose another time, or call us on ${CLINIC_PHONE}.`,
          slotGone: true,
        });
        slotGone();
      } else if (data.status === "succeeded") {
        setPayError({
          message: `Your payment went through, but we couldn't finish the booking automatically. The clinic will contact you to confirm, or call us on ${CLINIC_PHONE}.`,
        });
      } else if (data.error === "voucher") {
        voucherProblem(data.message);
      } else if (data.error === "paused") {
        setPausedMessage(data.message);
      } else if (data.error === "slot_taken") {
        setPayError({ message: data.message ?? "Someone else has just booked that time. Please choose another.", slotGone: true });
        slotGone();
      } else if (data.error === "missing_details") {
        // Their record changed since the code was checked: ask for what's missing.
        setReturning((r) => ({ ...r, missing: data.missing ?? r.missing }));
        setFieldErrors(validate(patient, data.missing ?? returning.missing));
        goTo(4);
      } else if (data.error === "authentication_required") {
        resetReturning("Your bank needs you to confirm this payment. Please enter your details to pay by card.");
        goTo(4);
      } else if (data.error === "card_unavailable") {
        resetReturning("Please enter your card details for this appointment. Nothing has been charged.");
        goTo(4);
      } else if (data.error === "session_expired") {
        resetReturning("Your code has expired. Ask for a new one, or enter your details instead.");
        goTo(4);
      } else {
        console.error("Saved-card payment:", data);
        setPayError({ message: data.message ?? `Something went wrong taking payment. Nothing has been charged. Please try again, or call us on ${CLINIC_PHONE}.` });
      }
    } catch {
      setPayError({ message: "Something went wrong taking payment. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckout() {
    if (!selectedPractitioner || !selectedType || !selectedTime) return;
    setSubmitting(true);
    setPayError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          practitionerId: selectedPractitioner.id,
          appointmentTypeId: selectedType.id,
          businessId,
          startsAtISO: selectedTime,
          paymentOption: "full",
          currency: "eur",
          visit: patientKind ?? undefined,
          policyAccepted,
          privacyAcknowledged,
          marketingOptIn,
          ...voucherBody,
          // Padded here too: Forward can reach this step without Continue on step 4.
          patient: { ...patient, dateOfBirth: normaliseDateOfBirth(patient.dateOfBirth) },
        }),
      });
      const data = await res.json();
      if (data.url) {
        rememberDraft();
        window.location.href = data.url;
        return; // keep the button in its "opening" state while the browser leaves
      }
      if (data.code === "voucher") {
        voucherProblem(data.error);
      } else if (data.code === "voucher_unsure" || data.code === "voucher_booking_failed") {
        setPayError({ message: data.error });
      } else if (data.code === "paused") {
        setPausedMessage(data.error);
      } else if (data.code === "slot_taken" || data.code === "slot_held") {
        setPayError({ message: data.error, slotGone: true });
        slotGone();
      } else {
        console.error("Checkout:", data.error, data.ref ?? "");
        if (data.error === "too_many_requests") {
          setPayError({ message: data.message });
          setSubmitting(false);
          return;
        }
        setPayError({ message: `We couldn't open the payment page. Nothing has been charged. Please try again, or call us on ${CLINIC_PHONE}.` });
      }
    } catch {
      setPayError({ message: "We couldn't open the payment page. Please check your connection and try again." });
    }
    setSubmitting(false);
  }

  // Back from an abandoned Stripe Checkout (?cancelled=1): restore the review screen.
  useEffect(() => {
    if (reception) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("cancelled") !== "1") return;
    const draft = readDraft();
    window.history.replaceState(historyState({ clinicStep: 1 }), "", "/");
    if (!draft) return;
    setSelectedType(draft.type);
    setSelectedArea(areaOf(draft.type));
    setPatientKind(draft.patientKind ?? kindOfType(draft.type.name));
    setSelectedPractitioner(draft.practitioner);
    setFirstAvailableChosen(draft.firstAvailable);
    setSelectedTime(draft.startsAtISO);
    setWeekStart(mondayOf(dublinDay(draft.startsAtISO)));
    setSelectedDay(dublinDay(draft.startsAtISO));
    setPatient((p) => ({ ...p, ...draft.patient }));
    setReturnedFromStripe(true);
    goTo(5, { replace: true });
  }, [goTo]);

  // Patients go straight on to Cliniko's page; reception stays here and is told why.
  useEffect(() => {
    if (redirectUrl && !reception) window.location.replace(redirectUrl);
  }, [redirectUrl, reception]);

  // ------------------------------------------------------------ render

  if (redirectUrl) {
    return (
      <>
        <SiteHeader variant={reception ? "staff" : undefined} />
        <main id="main" className="page page-narrow">
          {onDashboard && <BackToDashboard />}
          <div className="page-intro">
            <h1>{reception ? "Patients are being sent to Cliniko's booking page" : "Taking you to our booking page…"}</h1>
          </div>
          <Notice
            tone="warning"
            title={reception ? "Emergency switch is on" : "Online booking has moved for now"}
            actions={
              <>
                {!reception && (
                  <a className="btn btn-primary" href={redirectUrl}>
                    Continue to booking
                  </a>
                )}
                <a className={reception ? "btn btn-primary" : "btn btn-secondary"} href={CLINIC_TEL}>
                  <Icon name="phone" /> Call {CLINIC_PHONE}
                </a>
              </>
            }
          >
            <p>
              {reception
                ? "An owner has sent patients to Cliniko's own booking page, so payment links and card payments are off. Book phone patients straight into Cliniko; they pay at the clinic."
                : pausedMessage}
            </p>
          </Notice>
        </main>
      </>
    );
  }

  if (pausedMessage) {
    return (
      <>
        <SiteHeader variant={reception ? "staff" : undefined} />
        <main id="main" className="page page-narrow">
          {onDashboard && <BackToDashboard />}
          <div className="page-intro">
            <h1>Online booking is paused</h1>
          </div>
          <Notice
            tone="warning"
            title="Please call us to book"
            actions={
              <>
                <a className="btn btn-primary" href={CLINIC_TEL}>
                  <Icon name="phone" /> Call {CLINIC_PHONE}
                </a>
                <a className="btn btn-secondary" href="/manage">
                  Manage a booking
                </a>
              </>
            }
          >
            <p>{pausedMessage}</p>
          </Notice>
        </main>
      </>
    );
  }

  if (resumeOffer) {
    const name = `${resumeOffer.patient.firstName} ${resumeOffer.patient.lastName}`.trim();
    const what = [name, resumeOffer.startsAtISO ? whenShort(resumeOffer.startsAtISO) : resumeOffer.type?.name].filter(Boolean).join(", ");
    return (
      <>
        <SiteHeader variant="staff" />
        <main id="main" className="page page-narrow">
          {onDashboard && <BackToDashboard />}
          <div className="page-intro">
            <h1>{onlyPractitioner ? "Book a patient in" : "Book a patient by phone"}</h1>
          </div>
          <Notice
            actions={
              <>
                <button className="btn btn-primary" onClick={carryOn} disabled={resumeBusy}>
                  {resumeBusy ? "Checking the time…" : "Carry on"}
                </button>
                <button className="btn btn-secondary" onClick={startAgain} disabled={resumeBusy}>
                  Start again
                </button>
              </>
            }
          >
            <p>You have a booking in progress{what ? ` for ${what}` : ""}.</p>
          </Notice>
        </main>
      </>
    );
  }

  const cantBook = !!businessError;
  const summaryProps = {
    step: shownStep,
    type: selectedType,
    practitioner: selectedPractitioner,
    firstAvailable: firstAvailableChosen,
    startsAtISO: selectedTime,
    patientName: payingWithSavedCard ? "Saved card" : patient.firstName ? `${patient.firstName} ${patient.lastName}`.trim() : null,
    onChange: (s: Step) => goToStep(s),
  };

  if (reception && shownStep === 5 && selectedType && selectedPractitioner && selectedTime && businessId) {
    return (
      <>
        <SiteHeader variant="staff" />
        <main id="main" className="page">
          {onDashboard && <BackToDashboard />}
          <ReceptionPayStep
            adminKey={reception.adminKey}
            ownOnly={!!onlyPractitioner}
            type={selectedType}
            practitioner={selectedPractitioner}
            businessId={businessId}
            startsAtISO={selectedTime}
            patient={{ ...patient, dateOfBirth: normaliseDateOfBirth(patient.dateOfBirth) }}
            visit={patientKind}
            onChange={(s) => goToStep(s)}
            onSlotGone={(message) => {
              setPayError({ message, slotGone: true });
              slotGone();
            }}
            onDone={finishDraft}
            clinikoPatientId={chosenPatient?.id}
            headingRef={headingRef}
          />
        </main>
      </>
    );
  }

  if (shownStep === 5 && selectedType && selectedPractitioner && selectedTime) {
    return (
      <>
        <SiteHeader />
        <main id="main" className="page">
          {onDashboard && <BackToDashboard />}
          <ReviewStep
            type={selectedType}
            practitioner={selectedPractitioner}
            startsAtISO={selectedTime}
            patient={patient}
            savedCard={payingWithSavedCard ? returning.card : null}
            savedCardEmail={returning.email}
            consent={policyAccepted}
            setConsent={(v) => {
              setPolicyAccepted(v);
              if (v) setConsentError(false);
            }}
            consentError={consentError}
            consentRef={consentRef}
            privacy={privacyAcknowledged}
            setPrivacy={(v) => {
              setPrivacyAcknowledged(v);
              if (v) setPrivacyError(false);
            }}
            privacyError={privacyError}
            privacyRef={privacyRef}
            marketing={marketingOptIn}
            setMarketing={setMarketingOptIn}
            submitting={submitting}
            payError={payError}
            onPay={handlePay}
            onChange={(s) => {
              setPayError(null);
              setReturnedFromStripe(false);
              goToStep(s);
            }}
            returnedFromStripe={returnedFromStripe}
            headingRef={headingRef}
            voucher={
              voucherOn
                ? {
                    input: voucherInput,
                    setInput: (v) => {
                      setVoucherInput(v);
                      setVoucherError(null);
                    },
                    applied: voucherApplied,
                    applying: voucherApplying,
                    error: voucherError,
                    onApply: applyVoucher,
                    onRemove: () => setVoucherApplied(null),
                  }
                : undefined
            }
          />
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader variant={reception ? "staff" : undefined} />
      <main id="main" className="page">
          {onDashboard && <BackToDashboard />}
        {reception && shownStep === 1 && (
          <div className="block-gap stack-4">
            {onlyPractitioner ? (
              <Notice title="Booking a patient in with you">
                <p>
                  Go through the same steps as a patient would, asking them each question. Only you are listed as the practitioner. At the end
                  you&apos;ll send them a link to pay; the appointment goes in your diary once they&apos;ve paid. <a href="/dashboard">Back to the dashboard</a>
                </p>
              </Notice>
            ) : (
              <Notice title="Booking for a patient on the phone">
                <p>
                  Go through the same steps as a patient would, asking them each question. At the end you&apos;ll send them a link to pay, or
                  take their card over the phone. <a href={reception?.adminKey ? "/admin/bookings" : "/dashboard/bookings"}>Back to online bookings</a>
                </p>
              </Notice>
            )}
            {lookupOn &&
              (chosenPatient ? (
                <div>
                  <Notice
                    tone="success"
                    title={`Booking for ${chosenPatient.name}, from Cliniko`}
                    actions={
                      <button type="button" className="btn btn-secondary" onClick={forgetPatient}>
                        Not them? Search again
                      </button>
                    }
                  >
                    <p>
                      {lastVisit ? `Last time: ${visitLine(lastVisit)}. ` : ""}Their details are filled in on step 4, and the booking goes on their Cliniko record.
                    </p>
                    {sameTypeAgain && (
                      <p>
                        <button type="button" className="btn btn-primary" onClick={() => chooseType(sameTypeAgain)}>
                          Book {sameTypeAgain.name} again
                        </button>
                      </p>
                    )}
                  </Notice>
                </div>
              ) : (
                <PatientLookup onChoose={choosePatient} />
              ))}
          </div>
        )}
        {lookupOn && shownStep === 2 && lastPractitioner && (
          <div className="block-gap">
            <Notice
              title={`${chosenPatient?.name} last saw ${lastPractitioner.firstName} ${lastPractitioner.lastName}`}
              actions={
                <button type="button" className="btn btn-secondary" onClick={() => choosePractitioner(lastPractitioner)}>
                  Choose {lastPractitioner.firstName} {lastPractitioner.lastName}
                </button>
              }
            >
              <p>Or choose someone else below.</p>
            </Notice>
          </div>
        )}
        <div className="flow">
          <div className="flow-main">
            {shownStep > 1 && <MobileSummary {...summaryProps} />}

            {shownStep === 1 && (
              <TreatmentStep
                types={appointmentTypes}
                kind={patientKind}
                onChooseKind={chooseKind}
                loading={typesLoading}
                failed={!!typesError || cantBook}
                selectedId={selectedType?.id ?? null}
                area={selectedArea}
                onChooseArea={(a) => chooseArea(a)}
                onAllAreas={() => chooseArea(null)}
                onChoose={chooseType}
                headingRef={headingRef}
              />
            )}

            {shownStep === 2 && (
              <PractitionerStep
                practitioners={practitioners}
                loading={practitionersLoading || (!businessId && !businessError)}
                failed={!!practitionersError || cantBook}
                selectedId={selectedPractitioner?.id ?? null}
                firstAvailableChosen={firstAvailableChosen}
                onChoose={choosePractitioner}
                onChooseFirstAvailable={chooseFirstAvailable}
                waitlistHref={selectedType && waitlistOn() ? `/waitlist?type=${selectedType.id}` : undefined}
                headingRef={headingRef}
              />
            )}

            {shownStep === 3 && selectedPractitioner && (
              <TimeStep
                practitioner={selectedPractitioner}
                weekStart={weekStart}
                days={days}
                canGoBack={weekStart > mondayOf(todayDublin())}
                canGoForward={addDays(weekStart, 7) <= lastOnlineBookingDay(todayDublin())}
                onWeek={changeWeek}
                selectedDay={selectedDay}
                onSelectDay={selectDay}
                slots={daySlots}
                selectedTime={selectedTime}
                onSelectTime={(t) => {
                  setSelectedTime(t);
                  setTimeNotice(null);
                  setPayError(null);
                }}
                loading={!timesError && (timesLoading || weekTimes === undefined)}
                failed={!!timesError || cantBook}
                nextAvailableISO={selectedPractitioner.nextAvailableISO}
                onJumpTo={jumpTo}
                onContinue={continueFromTime}
                waitlistHref={selectedType && waitlistOn() ? `/waitlist?type=${selectedType.id}&practitioner=${selectedPractitioner.id}` : undefined}
                notice={
                  timeNotice ? (
                    <div className="block-gap">
                      <Notice tone="error">
                        <p>{timeNotice}</p>
                      </Notice>
                    </div>
                  ) : payError?.slotGone ? (
                    <div className="block-gap">
                      <Notice tone="error" title="That time has just been taken">
                        <p>{payError.message}</p>
                      </Notice>
                    </div>
                  ) : null
                }
                headingRef={headingRef}
              />
            )}

            {shownStep === 4 && (
              <DetailsStep
                patient={patient}
                setPatient={(p) => {
                  setPatient(p);
                  if (Object.keys(fieldErrors).length) setFieldErrors(payingWithSavedCard ? validate(p, returning.missing) : validate(p));
                }}
                errors={fieldErrors}
                summaryRef={errorSummaryRef}
                returning={returning}
                setReturning={setReturning}
                onStartReturning={startReturningLookup}
                onVerifyReturning={verifyReturningCode}
                onResetReturning={() => resetReturning()}
                onContinue={continueFromDetails}
                staff={!!reception}
                newPatient={patientKind === "new"}
                devFill={process.env.NODE_ENV !== "production" ? () => setPatient(randomTestPatient()) : undefined}
                headingRef={headingRef}
              />
            )}

            {shownStep > 1 && (
              <div className="step-actions">
                <button className="link-button" onClick={() => goToStep((shownStep - 1) as Step)}>
                  <Icon name="chevron-left" /> Back
                </button>
              </div>
            )}
          </div>

          <aside className="flow-aside" aria-label="Your booking">
            <BookingSummary {...summaryProps} />
          </aside>
        </div>
      </main>
    </>
  );
}
