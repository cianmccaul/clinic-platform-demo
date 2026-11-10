/**
 * Northbank Physio: a fictional clinic for the demo, in the same shapes the
 * real system reads from its practice management system (Cliniko). IDs are
 * numeric strings, like Cliniko's.
 */

export const BUSINESS = { id: "1", business_name: "Northbank Physio" };

export type DemoType = {
  id: string;
  name: string;
  category: string;
  description: string;
  duration_in_minutes: number;
  priceEUR: number;
  show_in_online_bookings: boolean;
};

export const TYPES: DemoType[] = [
  { id: "201", name: "Physiotherapy - New Patient", category: "Physiotherapy", duration_in_minutes: 60, priceEUR: 80, show_in_online_bookings: true, description: "A full assessment, a diagnosis and a plan, with treatment on the day." },
  { id: "202", name: "Physiotherapy - Returning Patient", category: "Physiotherapy", duration_in_minutes: 45, priceEUR: 70, show_in_online_bookings: true, description: "For patients continuing treatment." },
  { id: "205", name: "Physiotherapy with Shockwave - Returning Patient", category: "Physiotherapy", duration_in_minutes: 45, priceEUR: 95, show_in_online_bookings: true, description: "Follow-up physio with shockwave therapy, for tendon problems." },
  { id: "206", name: "Physiotherapy with Laser - Returning Patient", category: "Physiotherapy", duration_in_minutes: 45, priceEUR: 90, show_in_online_bookings: true, description: "Follow-up physio with laser therapy." },
  { id: "203", name: "Sports Massage - New Patient", category: "Massage", duration_in_minutes: 60, priceEUR: 75, show_in_online_bookings: true, description: "Deep tissue massage for recovery and tight muscles." },
  { id: "204", name: "Sports Massage - Returning Patient", category: "Massage", duration_in_minutes: 60, priceEUR: 70, show_in_online_bookings: true, description: "For patients who've had a massage with us before." },
];

export type DemoPractitioner = {
  id: string;
  first_name: string;
  last_name: string;
  title: string;
  /** Markdown-ish bio, read by core/bio.ts like the real profiles. */
  description: string;
  show_in_online_bookings: boolean;
  offers: string[];
  /** Working hours by weekday (0 = Sunday), Irish time. */
  hours: Partial<Record<number, [string, string]>>;
  /** The therapist's own Stripe account (direct charges). Clinic-paid staff have none. */
  account: string | null;
};

export const PRACTITIONERS: DemoPractitioner[] = [
  {
    id: "101", first_name: "Sarah", last_name: "Byrne", title: "Chartered Physiotherapist",
    description: "Sarah treats sports injuries, knees and runners. She works with local GAA and athletics clubs.\n\n**Special interests:** ACL rehab, running injuries, shockwave therapy.",
    show_in_online_bookings: true, offers: ["201", "202", "205"],
    hours: { 1: ["08:00", "16:00"], 2: ["08:00", "16:00"], 3: ["12:00", "20:00"], 4: ["08:00", "16:00"], 6: ["09:00", "13:00"] },
    account: "acct_demo_sarah",
  },
  {
    id: "102", first_name: "Mark", last_name: "Ryan", title: "Chartered Physiotherapist",
    description: "Mark looks after back and neck pain, posture and desk workers.\n\n**Special interests:** low back pain, headaches, laser therapy.",
    show_in_online_bookings: true, offers: ["201", "202", "206"],
    hours: { 1: ["12:00", "20:00"], 2: ["12:00", "20:00"], 4: ["12:00", "20:00"], 5: ["08:00", "16:00"] },
    account: "acct_demo_mark",
  },
  {
    id: "103", first_name: "Lucy", last_name: "Chen", title: "Sports Massage Therapist",
    description: "Lucy gives sports and deep tissue massage for recovery, training and tight muscles.",
    show_in_online_bookings: true, offers: ["203", "204"],
    hours: { 2: ["10:00", "18:00"], 3: ["10:00", "18:00"], 5: ["10:00", "18:00"], 6: ["09:00", "13:00"] },
    account: "acct_demo_lucy",
  },
  {
    id: "104", first_name: "Tom", last_name: "Hayes", title: "Chartered Physiotherapist",
    description: "Tom works with shoulders, rehab after surgery and older adults.\n\n**Special interests:** shoulder rehab, falls prevention, shockwave therapy.",
    show_in_online_bookings: true, offers: ["201", "202", "205"],
    hours: { 1: ["09:00", "17:00"], 3: ["09:00", "17:00"], 4: ["09:00", "17:00"], 5: ["09:00", "17:00"] },
    account: "acct_demo_tom",
  },
  {
    // Booked by phone only, and paid to the clinic (core/phone-only.ts, core/visit-payment.ts).
    id: "105", first_name: "Clare", last_name: "Morgan", title: "Clinic Director, Physiotherapist",
    description: "Clare founded the clinic. She sees a small number of complex cases, booked through reception.",
    show_in_online_bookings: true, offers: ["201", "202"],
    hours: { 2: ["09:00", "13:00"], 4: ["09:00", "13:00"] },
    account: null,
  },
];

export const STAFF_USER = { id: "staff_1", name: "Reception Demo", email: "reception@northbank.example", role: "admin" as const };

export const typeById = (id: string) => TYPES.find((t) => t.id === String(id));
export const practitionerById = (id: string) => PRACTITIONERS.find((p) => p.id === String(id));
export const practitionerName = (id: string) => {
  const p = practitionerById(id);
  return p ? `${p.first_name} ${p.last_name}` : "";
};
export const priceMinor = (typeId: string) => Math.round((typeById(typeId)?.priceEUR ?? 0) * 100);
export const accountFor = (practitionerId: string) => practitionerById(practitionerId)?.account ?? null;
