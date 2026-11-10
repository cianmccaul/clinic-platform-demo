/**
 * The demo's data, in the same shapes as production:
 * - patients and appointments as the diary (Cliniko) holds them,
 * - booking records exactly as the platform stores them (lib/bookings.ts),
 * - payments, refunds and checkout sessions as Stripe holds them.
 * In production these live in three systems; here they're one object in
 * the browser's local storage, so every visitor gets their own clinic.
 */
import type { BookingRecord } from "@/lib/bookings";
import type { WaitlistEntry as CoreWaitlistEntry } from "@/core/waitlist";

export type Patient = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string | null;
  address_1?: string;
  city?: string;
  created_at: string;
};

export type Appointment = {
  id: string;
  patient_id: string;
  practitioner_id: string;
  appointment_type_id: string;
  business_id: string;
  starts_at: string;
  ends_at: string;
  cancelled_at: string | null;
  did_not_arrive: boolean;
  patient_arrived: boolean;
  notes: string[];
  /** Set by the online booking flow, so a retried webhook finds it instead of creating a duplicate. */
  bookingKey?: string;
  created_at: string;
};

export type PaymentIntent = {
  id: string; // pi_...
  account: string | null; // the therapist's account, or null for the clinic's own
  amount: number;
  amount_refunded: number;
  created: string;
  card: { brand: string; last4: string };
  patientId: string | null;
  description: string;
};

export type Refund = { id: string; payment_intent: string; amount: number; reason: string; by: string; created: string };

export type CheckoutSession = {
  id: string; // cs_test_...
  status: "open" | "complete" | "expired";
  payment_status: "unpaid" | "paid";
  account: string | null;
  amount: number;
  createdAt: string;
  expiresAt: string;
  paymentIntentId?: string;
  meta: {
    practitionerId: string;
    appointmentTypeId: string;
    businessId: string;
    startsAtISO: string;
    patient: { firstName: string; lastName: string; email: string; phone: string; dateOfBirth: string };
    visit?: string;
    payLinkId?: string;
    rebookId?: string;
    visitPaymentId?: string;
    returnUrl?: string;
  };
};

export type CheckoutOutcome =
  | { state: "booked"; appointmentId: string; startsAtISO: string; appointmentTypeName?: string }
  | { state: "refunded"; reason: "slot_taken" | "booking_failed" }
  | { state: "rebook" }
  | { state: "delayed" };

export type Hold = { owner: string; practitionerId: string; startsAt: string; endsAt: string; expiresAt: string };

/** "You've already paid: pick another time" (production's lib/rebook.ts). */
export type Rebook = {
  id: string;
  token: string;
  status: "open" | "booked" | "refunded";
  createdAt: string;
  refundBy: string;
  sessionId: string;
  patient: { firstName: string; lastName: string; email: string };
  clinikoPatientId: string;
  practitionerId: string;
  practitionerName: string;
  appointmentTypeId: string;
  appointmentTypeName: string;
  businessId: string;
  originalStartsAtISO: string;
  amountMinor: number;
  paymentIntentId: string;
  bookedStartsAtISO?: string;
  bookedAppointmentId?: string;
};

export type PayLink = {
  id: string;
  token: string;
  status: "open" | "paid" | "expired" | "cancelled" | "refunded" | "rebook";
  createdAt: string;
  expiresAt: string;
  sentTo: { email?: string; phone?: string };
  practitionerId: string;
  appointmentTypeId: string;
  appointmentTypeName: string;
  startsAtISO: string;
  amountMinor: number;
  patient: { firstName: string; lastName: string; email: string; phone: string; clinikoPatientId?: string };
  appointmentId?: string;
  by: string;
  waitlistEntryId?: string;
};

/** "Pay for an appointment you've already had" (production's lib/visit-payments.ts). */
export type VisitPayment = {
  id: string;
  token: string;
  status: "pending" | "paid" | "cancelled";
  appointmentId: string;
  practitionerId: string;
  clinikoPatientId: string;
  firstName: string;
  email: string;
  appointmentTypeName: string;
  startsAtISO: string;
  amountMinor: number;
  createdAt: string;
  expiresAt: string;
  by: string;
};

/** A place on the waitlist: production's shape (core/waitlist.ts), plus the token in the patient's "leave" link. */
export type WaitlistEntry = CoreWaitlistEntry & { leaveToken: string };

export type Invoice = {
  id: string;
  number: string;
  kind: "invoice" | "credit_note";
  appointmentId: string;
  patientName: string;
  email: string;
  practitionerId: string;
  amountMinor: number;
  issuedAt: string;
  lines: { label: string; amountMinor: number }[];
};

export type OutboxEmail = { id: string; to: string; subject: string; text: string; at: string };
export type AuditEvent = { at: string; actor: "patient" | "reception" | "system"; by?: string; action: string; appointmentId?: string; amountMinor?: number; note?: string };

export type Db = {
  version: 4;
  seededFor: string;
  seq: number;
  patients: Patient[];
  appointments: Appointment[];
  bookings: Record<string, BookingRecord>;
  payments: PaymentIntent[];
  refunds: Refund[];
  sessions: CheckoutSession[];
  outcomes: Record<string, CheckoutOutcome>;
  holds: Hold[];
  savedCards: Record<string, { brand: string; last4: string; account: string | null }>;
  rebooks: Rebook[];
  payLinks: PayLink[];
  waitlist: WaitlistEntry[];
  visitPayments: VisitPayment[];
  kpiTargetMinor?: number | null;
  invoices: Invoice[];
  codes: { purpose: "manage" | "returning"; email: string; code: string; expiresAt: string }[];
  tokens: { token: string; purpose: "manage" | "returning"; patientIds: string[]; expiresAt: string }[];
  processedEvents: string[];
  outbox: OutboxEmail[];
  audit: AuditEvent[];
  flags: { onlineBooking: boolean; reason?: string };
};

export function emptyDb(day: string): Db {
  return {
    version: 4, seededFor: day, seq: 1000, patients: [], appointments: [], bookings: {}, payments: [], refunds: [], sessions: [], outcomes: {},
    holds: [], savedCards: {}, rebooks: [], payLinks: [], waitlist: [], visitPayments: [], invoices: [], codes: [], tokens: [], processedEvents: [], outbox: [], audit: [],
    flags: { onlineBooking: true },
  };
}

export function nextNum(db: Db) {
  db.seq += 1;
  return db.seq;
}
/** Numeric string ids, like Cliniko's. */
export const nextId = (db: Db) => String(3_000_000 + nextNum(db));
export const stripeId = (db: Db, prefix: "pi" | "re" | "cs_test" | "acct") => `${prefix}_d${nextNum(db).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const randomToken = () => Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

export function audit(db: Db, now: number, e: Omit<AuditEvent, "at">) {
  db.audit.unshift({ at: new Date(now).toISOString(), ...e });
  db.audit = db.audit.slice(0, 500);
}

export function sendEmail(db: Db, now: number, to: string, subject: string, text: string) {
  db.outbox.unshift({ id: `m${nextNum(db)}`, to, subject, text, at: new Date(now).toISOString() });
  db.outbox = db.outbox.slice(0, 100);
}

export const patientName = (p: Pick<Patient, "first_name" | "last_name"> | undefined) => (p ? `${p.first_name} ${p.last_name}` : "");
export const norm = (e: string) => e.trim().toLowerCase();

// Money on a booking record, as production's lib/bookings.ts works it out.
export const paidMinor = (b: BookingRecord) => b.payments.reduce((s, p) => s + p.amountMinor, 0);
export const refundedMinor = (b: BookingRecord) => b.payments.reduce((s, p) => s + p.refundedMinor, 0);
export const netPaidMinor = (b: BookingRecord) => paidMinor(b) - refundedMinor(b);
/** What counts towards the appointment fee: everything except extras. */
export const feeNetPaidMinor = (b: BookingRecord) => b.payments.filter((p) => p.kind !== "extra").reduce((s, p) => s + p.amountMinor - p.refundedMinor, 0);
export const paidOnline = (b: BookingRecord) => b.payments.length > 0;
