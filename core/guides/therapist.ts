import type { Guide } from "./types.ts";

/** Guides for therapists. Demo content. */
export const THERAPIST_GUIDES: Guide[] = [
  {
    slug: "extras",
    audience: "therapist",
    title: "Extra treatments",
    summary: "Adding shockwave or laser during a session.",
    updated: "2026-11-14",
    blocks: [
      {
        type: "steps",
        steps: [
          { text: "Only add an extra treatment if the patient agrees to it first." },
          {
            text: "Reception adds it from **Online bookings** with **Charge an extra…**. It's charged to the card the patient already used, on your own Stripe account.",
            shot: { id: "bookings-actions", alt: "One booking on the Online bookings page, with Refund or waive, Charge an extra, and Cancel and refund marked." },
          },
        ],
      },
      { type: "callout", tone: "info", title: "Machines", text: "There's one shockwave machine and one laser. The dashboard warns if two appointments need the same machine at once." },
    ],
  },
];
