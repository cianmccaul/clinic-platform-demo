/** Demo: types only. The real module is server code that talks to the database and Cliniko. */
import type { CapacityView, TherapistMonth, TherapistRules, Tier } from "@/core/therapist-stats";

export type TherapistRow = {
  practitionerId: string;
  name: string;
  rules: TherapistRules;
  tiers: Tier[];
  stats: TherapistMonth;
  capacity: CapacityView | null;
  pace: number | null;
  paceCapacityPct: number | null;
  /** Gift vouchers used with this therapist in the period (by the day entered; the clinic pays them this). Null: couldn't be read. */
  vouchersUsed?: { amountMinor: number; count: number } | null;
};
export type SourceCheck = { invoices: number; counted: number; otherBusinesses: { name: string; invoices: number }[]; noTherapist: number; creditNotes: number; hubReceipts?: number };
export type TherapistReport = {
  month: string;
  fromDay: string;
  toDay: string;
  computedAt: string;
  today: string;
  rows: TherapistRow[];
  notes: string[];
  source: SourceCheck;
  rulesVersion?: number;
};
