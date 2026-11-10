import type { PaymentOption } from "@/lib/pricing";
import type { GapField } from "@/core/patient-details";
import type { PatientKind } from "@/core/patient-kind";

export type Practitioner = {
  id: string;
  firstName: string;
  lastName: string;
  title?: string;
  description?: string;
  profilePictureUrl: string | null;
  // Earliest slot for the chosen appointment type, or null if none online.
  nextAvailableISO: string | null;
  /** Staff only: hidden from online booking (patients can't book them on the website). */
  notOnline?: boolean;
};

export type AppointmentType = {
  id: string;
  name: string;
  category: string | null;
  description?: string | null;
  durationMinutes: number;
  // What the patient pays when they book (the full price, from Cliniko).
  fullPriceEUR: number | null;
  /** Staff only: hidden from online booking (patients can't book it on the website). */
  notOnline?: boolean;
};

export type Patient = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  address: string;
  county: string;
  eircode: string;
  gpName: string;
  heardAboutUs: string;
  referredBy: string;
};

export const EMPTY_PATIENT: Patient = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  address: "",
  county: "",
  eircode: "",
  gpName: "",
  heardAboutUs: "",
  referredBy: "",
};

export type Step = 1 | 2 | 3 | 4 | 5;

export const STEP_TITLES: Record<Step, string> = {
  1: "Choose a treatment",
  2: "Choose a practitioner",
  3: "Choose a time",
  4: "Your details",
  5: "Review and pay",
};

export type ReturningState = {
  stage: "idle" | "open" | "codeSent" | "verified";
  email: string;
  code: string;
  token: string | null;
  card: { brand: string; last4: string } | null;
  // Details their Cliniko record lacks (names only), asked before paying.
  missing: GapField[];
  busy: boolean;
  error: string | null;
  sentAt: number | null;
};

/**
 * What the patient chose, kept in this tab's sessionStorage while they are
 * on Stripe so that (a) "back" from an abandoned Checkout restores the
 * review screen and (b) the confirmation page can show who/what/amount.
 * Deliberately excludes date of birth, address and GP (data minimisation);
 * cleared on the confirmation page.
 */
export type BookingDraft = {
  v: 1;
  type: AppointmentType;
  practitioner: Practitioner;
  firstAvailable: boolean;
  startsAtISO: string;
  // Drafts saved before 8 Oct 2026 may say "deposit"; new ones are always "full".
  paymentOption: PaymentOption;
  amountEUR: number;
  /** Part of it paid with a gift voucher (v2), in euro. */
  voucherEUR?: number;
  patient: Pick<Patient, "firstName" | "lastName" | "email" | "phone">;
  patientKind?: PatientKind | null;
};

export const DRAFT_KEY = "northbank-booking-draft";

export function readDraft(): BookingDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.v === 1 && d.type && d.practitioner && d.startsAtISO ? (d as BookingDraft) : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: BookingDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {}
}

export function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {}
}
