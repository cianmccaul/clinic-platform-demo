import type { Guide } from "./types.ts";

/** Reception guides. Demo content; every picture was captured from this demo. */
export const ADMIN_GUIDES: Guide[] = [
  {
    slug: "patient-lookup",
    audience: "admin",
    title: "Find a patient and their appointments",
    summary: "Look anyone up, then move or cancel their appointments, however they were booked.",
    updated: "2026-11-14",
    blocks: [
      {
        type: "steps",
        steps: [
          {
            text: "Open **Appointments** and search by surname, full name or date of birth. Pick the patient from the results.",
            shot: { id: "lookup-search", alt: "Find a patient, with Murphy typed in the search box and Jack Murphy in the results. Both are marked." },
          },
          {
            text: "Their upcoming appointments are listed. **Move** one to another time, **Cancel** it, or book them in again.",
            more: ["Cancelling follows the same 24-hour rule the patient sees, and you're shown what happens to their payment before you confirm."],
            shot: { id: "lookup-appointments", alt: "Jack Murphy's upcoming appointments, with the Move and Cancel buttons and the Book a new appointment link marked." },
          },
        ],
      },
    ],
  },
  {
    slug: "online-bookings",
    audience: "admin",
    title: "Online bookings: who has paid, refunds and no-shows",
    summary: "Check payments, refund, waive a fee or charge for an extra.",
    updated: "2026-11-14",
    blocks: [
      {
        type: "steps",
        steps: [
          {
            text: "Open **Online bookings** on the dashboard. Pick a day, or search by the patient's email.",
            shot: { id: "bookings-day", alt: "The top of Online bookings: the date box, the email search and the Pause online booking button are marked." },
          },
          { text: "Each booking shows what was paid, on which card, and whose Stripe account it went to." },
          {
            text: "Use **Refund or waive…** for money back or to waive a late fee, **Charge an extra…** when the patient agreed to an extra treatment, or **Cancel & refund**.",
            shot: { id: "bookings-actions", alt: "One booking on the Online bookings page, with Refund or waive, Charge an extra, and Cancel and refund marked." },
          },
        ],
      },
      { type: "callout", tone: "warning", title: "Late cancellations and no-shows", text: "Online bookings are paid in full when they're made, so the fee is already paid. Nothing more is charged. Waiving it refunds the patient." },
    ],
  },
  {
    slug: "phone-booking",
    audience: "admin",
    title: "Book a patient by phone",
    summary: "The patient's five steps, then a payment link by text or email, or their saved card.",
    updated: "2026-11-14",
    blocks: [
      {
        type: "steps",
        steps: [
          {
            text: "Open **Book a patient by phone** and look the caller up by name, date of birth or email. Picking them fills in their details.",
            shot: { id: "phone-lookup", alt: "The patient lookup on the phone booking page, with Hannah Lynch typed and found. The search box and the result are marked." },
          },
          {
            text: "Go through the same steps the patient would: treatment, practitioner and time. On the details step, check what's filled in with the caller.",
            shot: { id: "phone-details", alt: "The Patient's details step with the patient's details filled in from their record. The Continue button is marked." },
          },
          {
            text: "Send a **payment link** by text or email. The time is held for two hours, and the appointment is made as soon as they pay.",
            more: ["A returning patient can pay with their saved card instead, once they agree on the call."],
            shot: { id: "phone-pay", alt: "The payment step for a phone booking: Text them a payment link is marked, with the send button." },
          },
        ],
      },
    ],
  },
  {
    slug: "payment-went-wrong",
    audience: "admin",
    title: "When an online payment goes wrong",
    summary: "What the system does by itself, and what's left for you.",
    updated: "2026-11-14",
    blocks: [
      { type: "text", text: "Payment is taken first, then the appointment is written into the diary." },
      {
        type: "list",
        items: [
          "If the time was taken while the patient was paying, their payment is kept and they're emailed a link to pick another time with the same therapist. If they don't within 7 days, they're refunded in full automatically.",
          "If the diary can't be reached, the system keeps retrying. If it still can't, the patient is refunded in full, emailed, and the clinic is alerted.",
        ],
      },
      { type: "picture", shot: { id: "checkout-problems", alt: "The demo's pretend card page, with the Simulate a problem choices and the Pay button marked." }, caption: "In this demo you can make either one happen: choose it on the pretend card page before you pay." },
      { type: "picture", shot: { id: "rebook", alt: "The patient's pick another time page, listing free times with the first one marked." }, caption: "What the patient sees from the link: they've already paid, so they only pick a time." },
      { type: "callout", tone: "success", title: "Your job", text: "Patients waiting to pick a new time are listed at the top of **Appointments**. Ring them if they haven't chosen after a day or two. A patient is never left paid but not booked, and never charged twice." },
    ],
  },
  {
    slug: "waitlist",
    audience: "admin",
    title: "The waitlist",
    summary: "Patients waiting for a time, offers sent, and offering a time by hand.",
    updated: "2026-11-14",
    blocks: [
      { type: "text", text: "When a time opens up, people on the waitlist who fit it are offered it by text (or email, if their number isn't an Irish mobile). The link holds the time for two hours; the first to pay gets it." },
      {
        type: "steps",
        steps: [
          {
            text: "Open **Waitlist** to see who is waiting and which offers are out. **Look for times now** offers any free times that fit, **Add a patient** puts a caller on the list, and **Offer a time…** offers one patient a time by hand.",
            shot: { id: "waitlist-board", alt: "The waitlist board, with Look for times now, Add a patient and the first patient's Offer a time button marked." },
          },
        ],
      },
    ],
  },
  {
    slug: "desk-vouchers",
    audience: "admin",
    title: "Gift vouchers at the desk",
    summary: "Look a voucher up, use it for a treatment, undo a mistake, or send it again.",
    updated: "2026-11-14",
    blocks: [
      {
        type: "steps",
        steps: [
          {
            text: "Open **Gift vouchers**, type the code (or pick it from the recent list) and press **Use for a treatment**. Enter the amount and the therapist.",
            more: ["Every use is a line on the voucher. A mistake can be undone from the same page, and the amount goes back on the voucher."],
            shot: { id: "vouchers-desk", alt: "A voucher looked up on the dashboard: the code box and the Use for a treatment button are marked." },
          },
        ],
      },
      { type: "callout", tone: "info", title: "Used online too", text: "Patients can type the same code when they pay online. What an online booking is using is set aside while they pay, so it can't be spent twice." },
    ],
  },
];
