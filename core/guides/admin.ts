import type { Guide } from "./types.ts";

/** Reception guides. Demo content. */
export const ADMIN_GUIDES: Guide[] = [
  {
    slug: "online-bookings",
    audience: "admin",
    title: "Online bookings: who has paid, refunds and no-shows",
    summary: "Check payments, refund, waive a fee or charge for an extra.",
    updated: "2026-11-10",
    blocks: [
      {
        type: "steps",
        steps: [
          { text: "Open **Online bookings** on the dashboard. Search by name or email, or pick a day." },
          { text: "Each booking shows what was paid, on which card, and whose Stripe account it went to." },
          { text: "Use **Refund** for money back, **Waive the fee** for a late cancellation or no-show, or **Charge an extra** when the patient agreed to an extra treatment." },
        ],
      },
      { type: "callout", tone: "warning", title: "Late cancellations and no-shows", text: "Online bookings are paid in full when they're made, so the fee is already paid. Nothing more is charged. Waiving it refunds the patient." },
    ],
  },
  {
    slug: "phone-booking",
    audience: "admin",
    title: "Book a patient by phone",
    summary: "The patient's five steps, then a payment link or their card.",
    updated: "2026-11-10",
    blocks: [
      {
        type: "steps",
        steps: [
          { text: "Open **Book a patient by phone** and look the patient up by name, email or phone." },
          { text: "Go through the same five steps the patient would: treatment, practitioner, time, details." },
          { text: "Send a **payment link** by email or text. The appointment is made as soon as they pay." },
        ],
      },
    ],
  },
  {
    slug: "payment-went-wrong",
    audience: "admin",
    title: "When an online payment goes wrong",
    summary: "What the system does by itself, and what's left for you.",
    updated: "2026-11-10",
    blocks: [
      { type: "text", text: "Payment is taken first, then the appointment is written into the diary." },
      {
        type: "list",
        items: [
          "If the time was taken while the patient was paying, they're refunded in full straight away and emailed.",
          "If the diary can't be reached, the system keeps retrying. If it still can't, the patient is refunded in full, emailed, and the clinic is alerted.",
        ],
      },
      { type: "callout", tone: "success", title: "Your job", text: "Call the patient and find them another time. A patient is never left paid but not booked, and never charged twice." },
    ],
  },
  {
    slug: "waitlist",
    audience: "admin",
    title: "The waitlist",
    summary: "Patients waiting for a time, offers sent, and offering a time by hand.",
    updated: "2026-11-10",
    blocks: [
      { type: "text", text: "When a time opens up, people on the waitlist who fit it are offered it by text and email. The first to accept gets it." },
      { type: "steps", steps: [{ text: "Open **Waitlist** to see who is waiting and which offers are out." }, { text: "To offer a time yourself, add the patient and the days that suit them." }] },
    ],
  },
];
