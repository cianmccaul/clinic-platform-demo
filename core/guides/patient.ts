import type { Guide } from "./types.ts";

/** Patient guides: public on the help centre. Demo content for a fictional clinic. */
export const PATIENT_GUIDES: Guide[] = [
  {
    slug: "book-online",
    audience: "patient",
    title: "Book an appointment online",
    summary: "Choose a treatment, a practitioner and a time, then pay to confirm.",
    updated: "2026-11-10",
    blocks: [
      {
        type: "steps",
        steps: [
          { text: "Go to **Book an appointment** and choose the kind of care you need." },
          { text: "Pick a practitioner. Each one shows their next free time." },
          { text: "Choose a day and time. We hold it for you while you pay." },
          { text: "Add your details, read the cancellation policy, and pay by card." },
          { text: "You'll see a confirmation straight away, and get an email with the details." },
        ],
      },
      { type: "callout", tone: "info", title: "If the time goes while you pay", text: "Very occasionally someone else books the same time at the same moment. If that happens, you're refunded in full automatically and we email you to explain." },
    ],
  },
  {
    slug: "change-or-cancel",
    audience: "patient",
    title: "Change or cancel your booking",
    summary: "Move or cancel online, without calling us.",
    updated: "2026-11-10",
    blocks: [
      {
        type: "steps",
        steps: [
          { text: "Go to [Manage a booking](/manage) and enter the email you booked with." },
          { text: "Enter the 6-digit code we email you." },
          { text: "Choose **Change time** to pick a new time, or **Cancel**." },
        ],
      },
      { type: "callout", tone: "warning", title: "The 24-hour rule", text: "Free to cancel or change until 24 hours before. After that, or if you miss the appointment, the full appointment fee is charged." },
    ],
  },
];
