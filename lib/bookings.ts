/** Demo: the booking record types only. The real module stores them in Redis. */
import type { BookingVoucher } from "@/core/vouchers";

export type PaymentKind = "deposit" | "full" | "balance" | "no_show" | "late_cancel" | "extra";

export type PaymentEntry = {
  paymentIntentId: string;
  kind: PaymentKind;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  destination: "clinic" | "therapist";
  // The therapist's own Stripe account, when the payment was made there
  // (direct charge, ADR 0006): refunds must be made on that account too.
  // Unset with destination "therapist" = an older destination charge.
  directOnAccount?: string;
  /** Looked for on the therapists' accounts and not there: an older destination charge (lib/charges.ts fillMissingDirectAccounts). */
  directChecked?: boolean;
  at: string;
  /** For an extra: what it was ("Shockwave"), for the invoice line. */
  label?: string;
  /** Invoicing only (lib/hub-invoices.ts): the voucher part of a booking, shown as its own payment. Never stored in payments. */
  voucherCode?: string;
};

export type BookingRecord = {
  appointmentId: string;
  clinikoPatientId: string;
  patientName?: string;
  patientEmail?: string;
  businessId: string;
  practitionerId: string;
  appointmentTypeId: string;
  appointmentTypeName?: string;
  startsAtISO: string;
  durationMinutes: number;
  status: "booked" | "cancelled";
  cancelledAt?: string;
  cancelledBy?: "patient" | "clinic";
  lateCancellation?: boolean;
  payments: PaymentEntry[];
  createdAt: string;
  // "cliniko": booked by hand in Cliniko (no online payment); only saved
  // here once the patient cancels/moves it online.
  source?: "online" | "cliniko";
  /** Paid (all or part) with a gift voucher when booked online (v2, core/vouchers.ts). */
  voucher?: BookingVoucher;
};
