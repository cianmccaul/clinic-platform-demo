import type { Guide } from "./types.ts";

/** The first guide every member of staff reads. Demo content. */
export const START_HERE_GUIDES: Guide[] = [
  {
    slug: "start-here",
    audience: "therapist",
    title: "Start here: how the clinic's systems fit together",
    summary: "Which system to use for what.",
    updated: "2026-11-10",
    blocks: [
      {
        type: "table",
        head: ["For", "Use"],
        rows: [
          ["Appointments, patient notes, the diary", "The practice management system (Cliniko)"],
          ["Card payments, refunds, payouts", "Stripe, through this dashboard"],
          ["Online bookings, phone bookings, pay links, refunds, no-shows", "This dashboard"],
          ["How do I...?", "These guides"],
        ],
      },
      { type: "text", text: "The diary is always the source of truth for who is booked when. The dashboard asks the diary every time, so it never shows an out-of-date copy." },
      { type: "callout", tone: "info", title: "Therapists are paid directly", text: "Every payment for your appointments goes straight into your own Stripe account. The clinic invoices room rent separately at the end of the month." },
    ],
  },
];
