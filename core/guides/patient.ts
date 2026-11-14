import type { Guide } from "./types.ts";

/**
 * Patient guides: public on the help centre. Demo content for a fictional
 * clinic; every picture was captured from this demo (scripts/guide-shots.mjs).
 */
export const PATIENT_GUIDES: Guide[] = [
  {
    slug: "book-online",
    audience: "patient",
    title: "Book an appointment online",
    summary: "Choose a treatment, a practitioner and a time, then pay to confirm.",
    updated: "2026-11-14",
    blocks: [
      {
        type: "steps",
        steps: [
          {
            text: "Go to [Book an appointment](book:/) and tap the kind of care you need. Its choices open underneath: say whether you've been before, then pick the appointment.",
            shot: { id: "book-treatment", alt: "The Choose a treatment step with Physiotherapy open, then Return Patient, showing its appointments and prices. Numbered callouts mark each of the three taps." },
          },
          {
            text: "Pick a practitioner. Each one shows their next free time.",
            shot: { id: "book-practitioner", alt: "The list of practitioners, each with their next free time. The first one is marked." },
          },
          {
            text: "Choose a day and a time, then **Continue**. We hold the time for you while you pay.",
            shot: { id: "book-time", alt: "The times for the week, with one chosen and the Continue button marked." },
          },
          {
            text: "Add your details. **Been to see us before?** Choose **Use my details on file** and we'll email you a 6-digit code instead of asking you to type everything again.",
            shot: { id: "book-details", alt: "The Your details step. The button Use my details on file is marked." },
          },
          {
            text: "Enter the code. If we have your details, there's nothing to fill in; we only ask for anything that's missing.",
            more: ["If you've paid online before, your saved card is used too, so you skip the card page as well."],
            shot: { id: "book-details-found", alt: "A green notice saying your details are already on file, with the Continue button marked." },
          },
          {
            text: "Check the summary, agree to the cancellation policy, and **Pay**. Have a gift voucher? Type its code here first.",
            shot: { id: "book-pay", alt: "The Pay step, with the Have a gift voucher section and the agreement to the cancellation policy marked." },
          },
          {
            text: "You'll see the confirmation straight away, and get an email with the details.",
            shot: { id: "book-confirmed", alt: "The confirmation page for the booked appointment." },
          },
        ],
      },
      {
        type: "callout",
        tone: "info",
        title: "If the time goes while you pay",
        text: "Very occasionally someone else books the same time at the same moment. Your payment is kept safe and we email you a link to pick another time with the same practitioner, with nothing more to pay. If you'd rather not, ask for a refund on the same page; if you do nothing, you're refunded in full automatically after 7 days.",
      },
      { type: "picture", shot: { id: "rebook", alt: "The pick another time page: it says you have already paid, and lists free times. The first time is marked." }, caption: "The link in that email opens this page." },
    ],
  },
  {
    slug: "change-or-cancel",
    audience: "patient",
    title: "Change or cancel your booking, and see past payments",
    summary: "Move or cancel online without calling us, and check what you've paid.",
    updated: "2026-11-14",
    blocks: [
      {
        type: "steps",
        steps: [
          {
            text: "Go to [Manage a booking](book:/manage), enter the email you booked with, and press **Send code**.",
            shot: { id: "manage-email", alt: "Manage a booking, with the email box and the Send code button marked." },
          },
          {
            text: "Enter the 6-digit code we send you. It lasts 10 minutes.",
            more: ["In this demo the code slides in as a simulated notification at the top right: click it to fill the code in."],
            shot: { id: "manage-code", alt: "The Check your email page. A simulated notification at the top shows the code; the code box and the Continue button are marked." },
          },
          {
            text: "Choose **Change time** to pick a new time, or **Cancel booking**. You're told what will be refunded before you confirm.",
            shot: { id: "manage-bookings", alt: "Your bookings, with the Change time and Cancel booking buttons marked on the first one." },
          },
          {
            text: "Scroll down to **Past payments** to see everything you've paid, on which card, and anything refunded.",
            shot: { id: "manage-payments", alt: "The Past payments list: each payment with its date, card and amount. A refunded payment is marked." },
          },
        ],
      },
      { type: "callout", tone: "warning", title: "The 24-hour rule", text: "Free to cancel or change until 24 hours before. After that, or if you miss the appointment, the full appointment fee is charged." },
    ],
  },
  {
    slug: "gift-vouchers",
    audience: "patient",
    title: "Buy and use a gift voucher",
    summary: "Buy a voucher for any amount, check what's left, and use it when you book.",
    updated: "2026-11-14",
    blocks: [
      { type: "heading", text: "Buy a voucher" },
      {
        type: "steps",
        steps: [
          {
            text: "Go to [Gift vouchers](book:/vouchers) and choose an amount. Say whether we email it to you, or straight to the person it's for.",
            shot: { id: "voucher-amount", alt: "The gift voucher page, with the amount choices and the question of who to email it to marked." },
          },
          {
            text: "Add your name and email, then pay by card. The voucher's code arrives by email within a minute.",
            shot: { id: "voucher-pay", alt: "The end of the gift voucher form, with the email box and the pay button marked." },
          },
        ],
      },
      { type: "heading", text: "Check what's left" },
      {
        type: "steps",
        steps: [
          {
            text: "Go to [Check a gift voucher](book:/vouchers/balance) and type the code.",
            shot: { id: "voucher-balance", alt: "Check a gift voucher, with the code box and the answer (the amount left and the last day it can be used) marked." },
          },
        ],
      },
      { type: "heading", text: "Use it when you book" },
      {
        type: "steps",
        steps: [
          {
            text: "On the Pay step, open **Have a gift voucher?**, type the code and press **Apply**. The voucher comes off the fee and your card pays only the rest.",
            more: ["Whatever isn't used stays on the voucher. If you cancel in good time, the voucher's part goes back on the voucher."],
            shot: { id: "voucher-use", alt: "The Pay step with a gift voucher applied, showing the amount taken off the fee." },
          },
        ],
      },
      { type: "callout", tone: "info", title: "Vouchers last 5 years", text: "A voucher can be used in one visit or several, towards any treatment, for 5 years from the day it was bought." },
    ],
  },
];
