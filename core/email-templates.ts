/**
 * The words of every email the Hub sends, as templates reception and owners
 * can change on the dashboard (Emails page, 31 Oct 2026). Pure, no I/O, unit-tested.
 *
 * - Each template has the clinic's original words (the defaults below) and a
 *   list of placeholders, written {first_name}, that the Hub fills in.
 * - A placeholder marked `optional` isn't always there (a voucher message, a
 *   saved card's last four digits). When it's empty, the whole paragraph it
 *   sits in is left out, so the email never reads "on the card ending ."
 * - `required` placeholders can't be removed (the voucher's legal details,
 *   the verification code, the details of a clinic alert).
 * - A saved change that no longer passes the checks (say a placeholder was
 *   renamed in the code since) is ignored and the original words are used,
 *   so an email is never sent half-filled.
 *
 * The layout (logo, button, policy sentence, footer) stays in core/email-html.ts.
 * Changing a default here changes the email for everyone who hasn't edited it.
 */

export type EmailVar = {
  name: string;
  /** What it is, for the dashboard. */
  label: string;
  /** Shown in the preview and the test email. */
  sample: string;
  /** Not always there: its paragraph is left out when it's empty. */
  optional?: boolean;
  /** Used when the value is missing, e.g. "there" for "Hi there". */
  fallback?: string;
};

export type EmailTemplateDef = {
  name: string;
  group: EmailGroup;
  /** When it's sent, in a sentence. */
  sentWhen: string;
  to: "patient" | "voucher buyer" | "voucher recipient" | "staff" | "clinic";
  subject: string;
  body: string;
  /** The navy button's label; the link itself is fixed. */
  button?: string;
  /** The cancellation policy sentence is added at the end. */
  policy?: boolean;
  /** Shown above the editor. */
  note?: string;
  vars: readonly EmailVar[];
  /** Placeholders that must stay: in the subject and/or the body. */
  required?: { subject?: readonly string[]; body?: readonly string[] };
};

export const EMAIL_GROUPS = ["Payments and bookings", "Cancellations and refunds", "Waitlist", "Gift vouchers", "Invoices", "Sign-in and staff", "Clinic emails"] as const;
export type EmailGroup = (typeof EMAIL_GROUPS)[number];

// ---- Placeholders used by many templates.
const FIRST = { name: "first_name", label: "Patient's first name", sample: "Mary", fallback: "there" } as const;
const TREATMENT = { name: "treatment", label: "Treatment", sample: "Physiotherapy", fallback: "appointment" } as const;
const PRACTITIONER = { name: "practitioner", label: "Therapist", sample: "Aoife Byrne" } as const;
const WHEN = { name: "when", label: "Appointment day and time", sample: "Tuesday 13 October, 10:30am" } as const;
const WHEN_SHORT = { name: "when_short", label: "Day and time, short (for subjects)", sample: "Tue 13 Oct, 10:30am" } as const;
const PHONE = { name: "clinic_phone", label: "Clinic phone number", sample: "01 555 0100" } as const;
const AMOUNT = { name: "amount", label: "Amount", sample: "€65.00" } as const;
const HOLD_UNTIL = { name: "hold_until", label: "Time the slot is held until", sample: "4:30pm" } as const;
const EXTRAS = {
  name: "extras_sentence",
  label: "The clinic's sentence about extra treatments",
  sample: "If your practitioner suggests an extra treatment, such as shockwave or laser, it's only given if you agree, and it's charged on top of the appointment fee to the card you paid with.",
} as const;
const COMPANY_NAME = { name: "company", label: "Company name", sample: "Northbank Physio" } as const;

/** Keeps placeholder names as literal types, so every call site is type-checked against its template. */
const t = <const V extends readonly EmailVar[]>(d: Omit<EmailTemplateDef, "vars"> & { vars: V }) => d;

const SIGN_OFF = "Northbank";

export const EMAIL_TEMPLATES = {
  // ---------------- Payments and bookings
  pay_link: t({
    name: "Payment link (phone booking)",
    group: "Payments and bookings",
    sentWhen: "Reception or a therapist books a patient by phone and sends the payment link by email.",
    to: "patient",
    subject: "Please pay to confirm: {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "Thanks for calling Northbank. Here's the link to pay for your {treatment} with {practitioner} on {when}: {amount}, paid in full.\n\n" +
      "We're holding the time for you until {hold_until}. Your appointment is confirmed as soon as you've paid, and we'll email you then.\n\n" +
      "{extras_sentence}\n\n" +
      "If you have any questions, call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    button: "Pay {amount} securely",
    policy: true,
    vars: [FIRST, TREATMENT, PRACTITIONER, WHEN, WHEN_SHORT, AMOUNT, HOLD_UNTIL, EXTRAS, PHONE],
  }),
  visit_pay_link: t({
    name: "Payment link (appointment already happened)",
    group: "Payments and bookings",
    sentWhen: "A therapist or reception asks a patient to pay for an appointment they've already had, and emails the link.",
    to: "patient",
    subject: "Payment for your {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "Thanks for coming in to see {practitioner}. Here's the link to pay for your {treatment} on {when}: {amount}.\n\n" +
      "The link works until {link_until}. If you've already paid, there's nothing more to do.\n\n" +
      "If you have any questions, call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    button: "Pay {amount} securely",
    vars: [FIRST, PRACTITIONER, TREATMENT, WHEN, WHEN_SHORT, AMOUNT, { name: "link_until", label: "Last day the link works", sample: "Friday 20 November" }, PHONE],
  }),
  approval: t({
    name: "Approve a saved-card payment (phone booking)",
    group: "Payments and bookings",
    sentWhen: "Reception charges a returning patient's saved card by phone and their bank asks them to approve it.",
    to: "patient",
    subject: "Please approve your payment: {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "Thanks for calling Northbank. Your bank needs you to approve the {amount} payment for your {treatment} with {practitioner} on {when}.\n\n" +
      "The payment is on the card ending {card_last4} that you saved with us.\n\n" +
      "We're holding the time for you until {hold_until}. Your appointment is confirmed as soon as you've approved it.\n\n" +
      "If you have any questions, call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    button: "Approve {amount}",
    policy: true,
    vars: [FIRST, AMOUNT, TREATMENT, PRACTITIONER, WHEN, WHEN_SHORT, { name: "card_last4", label: "Last four digits of the saved card", sample: "4242", optional: true }, HOLD_UNTIL, PHONE],
  }),
  moved: t({
    name: "Appointment moved",
    group: "Payments and bookings",
    sentWhen: "A patient (on Manage a booking) or reception moves a paid booking to a new time.",
    to: "patient",
    subject: "Moved: {treatment}, {new_when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "Your {treatment} has been moved from {old_when} to {new_when}.\n\n" +
      "Your payment of {paid} carries over, so there's nothing more to pay now.\n\n" +
      "{extras_sentence}\n\n" +
      "Need to change it again? Use the button below or call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    button: "Manage booking",
    policy: true,
    vars: [
      FIRST,
      TREATMENT,
      { name: "old_when", label: "Old day and time", sample: "Tuesday 13 October, 10:30am" },
      { name: "new_when", label: "New day and time", sample: "Thursday 15 October, 2:00pm" },
      { name: "new_when_short", label: "New day and time, short (for subjects)", sample: "Thu 15 Oct, 2:00pm" },
      { name: "paid", label: "Amount already paid", sample: "€65.00", optional: true },
      EXTRAS,
      PHONE,
    ],
  }),
  extra_charge: t({
    name: "Extra treatment charged",
    group: "Payments and bookings",
    sentWhen: "Reception charges an agreed extra treatment (shockwave, laser…) to the patient's card.",
    to: "patient",
    subject: "Payment for extra treatment: {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "As agreed at your appointment on {when}, we've charged {amount} for {extra} to the card you booked with.\n\n" +
      "Any questions, call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    vars: [FIRST, TREATMENT, WHEN, WHEN_SHORT, AMOUNT, { name: "extra", label: "What the extra was", sample: "shockwave" }, PHONE],
  }),
  no_show: t({
    name: "Missed appointment charged",
    group: "Payments and bookings",
    sentWhen: "Reception charges the full price for a missed appointment.",
    to: "patient",
    subject: "Missed appointment charge: {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "We missed you at your {treatment} on {when}. Under our cancellation policy, missed appointments are charged the full price, so we've charged {amount} to the card you booked with.\n\n" +
      "Any questions, call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    policy: true,
    vars: [FIRST, TREATMENT, WHEN, WHEN_SHORT, AMOUNT, PHONE],
  }),
  balance: t({
    name: "Balance charged",
    group: "Payments and bookings",
    sentWhen: "Reception charges the rest of the price after a deposit.",
    to: "patient",
    subject: "Payment received: {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "We've charged the remaining {amount} for your {treatment} on {when} to the card you booked with.\n\n" +
      "Any questions, call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    vars: [FIRST, TREATMENT, WHEN, WHEN_SHORT, AMOUNT, PHONE],
  }),

  // ---------------- Cancellations and refunds
  cancel_refund: t({
    name: "Cancelled and refunded",
    group: "Cancellations and refunds",
    sentWhen: "A paid booking is cancelled in time and the money goes back (to the card, a gift voucher, or both). Cliniko sends its own cancellation email too.",
    to: "patient",
    subject: "Cancelled and refunded: {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "Your {treatment} on {when} has been cancelled.\n\n" +
      "We've refunded {refund_amount} to your card. It can take 5–10 working days to appear on your statement.\n\n" +
      "{voucher_amount} has gone back on your {voucher}, so you can use it again.\n\n" +
      SIGN_OFF,
    policy: true,
    vars: [
      FIRST,
      TREATMENT,
      WHEN,
      WHEN_SHORT,
      { name: "refund_amount", label: "Amount refunded to the card", sample: "€65.00", optional: true },
      { name: "voucher_amount", label: "Amount put back on a gift voucher", sample: "€20.00", optional: true },
      { name: "voucher", label: "The gift voucher (code hidden)", sample: "gift voucher ••••-7KQ2", optional: true },
    ],
  }),
  cancel_fee: t({
    name: "Late cancellation fee charged",
    group: "Cancellations and refunds",
    sentWhen: "A booking is cancelled with less than 24 hours' notice and the rest of the fee is charged to the card.",
    to: "patient",
    subject: "Cancelled, cancellation fee applies: {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "As your {treatment} on {when} was cancelled with less than 24 hours' notice, our cancellation fee of the full appointment price applies. We've kept the {already_paid} you'd already paid and charged the remaining {fee_charged} to the card you booked with.\n\n" +
      "If you had a genuine emergency, please call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    policy: true,
    vars: [
      FIRST,
      TREATMENT,
      WHEN,
      WHEN_SHORT,
      { name: "already_paid", label: "Amount already paid (kept)", sample: "€20.00" },
      { name: "fee_charged", label: "Amount charged now", sample: "€45.00" },
      PHONE,
    ],
  }),
  cancel_fee_unpaid: t({
    name: "Late cancellation fee, not charged yet",
    group: "Cancellations and refunds",
    sentWhen: "A booking is cancelled with less than 24 hours' notice, but the rest of the fee couldn't be charged to the card.",
    to: "patient",
    subject: "Cancelled, cancellation fee applies: {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "As your {treatment} on {when} was cancelled with less than 24 hours' notice, our cancellation fee of the full appointment price applies. The clinic will be in touch about the remaining balance.\n\n" +
      "If you had a genuine emergency, please call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    policy: true,
    vars: [FIRST, TREATMENT, WHEN, WHEN_SHORT, PHONE],
  }),
  refund: t({
    name: "Refund by the clinic",
    group: "Cancellations and refunds",
    sentWhen: "Reception refunds some or all of a booking on the Online bookings page.",
    to: "patient",
    subject: "Refund: {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "We've refunded {amount} for your {treatment} on {when} to the card you paid with. It can take 5–10 working days to appear on your statement.\n\n" +
      "Any questions, call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    vars: [FIRST, TREATMENT, WHEN, WHEN_SHORT, AMOUNT, PHONE],
  }),
  not_booked_slot_taken: t({
    name: "Not booked: time taken, refunded",
    group: "Cancellations and refunds",
    sentWhen: "Someone else booked the time just before the patient's payment went through, so it was refunded automatically.",
    to: "patient",
    subject: "Not booked, refunded in full: {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "Sorry — the appointment time you chose was booked by someone else just before your payment went through, so we couldn't confirm it. Your payment of {amount} has been refunded in full; it can take 5–10 working days to show on your statement.\n\n" +
      "Please book another time online or call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    button: "Book another time",
    vars: [FIRST, TREATMENT, WHEN_SHORT, AMOUNT, PHONE],
  }),
  not_booked_failed: t({
    name: "Not booked: system problem, refunded",
    group: "Cancellations and refunds",
    sentWhen: "The booking couldn't be made in Cliniko for 2 hours after the patient paid, so it was refunded automatically.",
    to: "patient",
    subject: "Not booked, refunded in full: {treatment}, {when_short} – Northbank",
    body:
      "Hi {first_name},\n\n" +
      "Sorry — a problem with our booking system meant we couldn't confirm the appointment you paid for. Your payment of {amount} has been refunded in full; it can take 5–10 working days to show on your statement.\n\n" +
      "We'll be in touch to rebook, or you can call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    vars: [FIRST, TREATMENT, WHEN_SHORT, AMOUNT, PHONE],
  }),

  // ---------------- Waitlist
  waitlist_joined: t({
    name: "Joined the waitlist",
    group: "Waitlist",
    sentWhen: "A patient joins the waitlist (or reception adds them).",
    to: "patient",
    subject: "You're on the Northbank waitlist",
    body:
      "Hi {first_name},\n\n" +
      "You're on the waitlist for {treatment} with {practitioner}. When a time opens up that suits you, we'll send {offer_by} with a link to book it. You'll have 2 hours to take it; after that it goes to the next person.\n\n" +
      "Nothing is booked or charged until you pay for a time we offer.\n\n" +
      "To leave the waitlist at any time: {leave_link}\n\n" +
      "If you have any questions, call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    vars: [FIRST, TREATMENT, PRACTITIONER, { name: "offer_by", label: "How offers will come (\"a text message\" or \"an email\")", sample: "an email" }, { name: "leave_link", label: "Link to leave the waitlist", sample: "https://book.northbank.example/waitlist/leave/…" }, PHONE],
  }),
  waitlist_offer: t({
    name: "Waitlist: a time has opened up",
    group: "Waitlist",
    sentWhen: "A time opens up for someone on the waitlist (by email when texts aren't used).",
    to: "patient",
    subject: "A time has opened up: {when_short}",
    body:
      "Hi {first_name},\n\n" +
      "You're on our waitlist, and a time has opened up for your {treatment} with {practitioner}: {when_short}. It costs {amount}, paid in full to confirm it.\n\n" +
      "We're holding it for you until {hold_until}. If you don't book it by then, we'll offer it to the next person and you'll stay on the waitlist.\n\n" +
      "This email was sent for {waitlist_name} on the waitlist. If it isn't for you, please ignore it.\n\n" +
      "If you no longer need a time, you can leave the waitlist here: {leave_link}\n\n" +
      "If you have any questions, call us on {clinic_phone}.\n\n" +
      SIGN_OFF,
    button: "Book and pay {amount}",
    vars: [
      FIRST,
      TREATMENT,
      PRACTITIONER,
      WHEN_SHORT,
      AMOUNT,
      HOLD_UNTIL,
      { name: "waitlist_name", label: "First name on the waitlist entry", sample: "Mary", fallback: "the person" },
      { name: "leave_link", label: "Link to leave the waitlist", sample: "https://book.northbank.example/waitlist/leave/…", optional: true },
      PHONE,
    ],
  }),

  // ---------------- Gift vouchers
  voucher_buyer: t({
    name: "Gift voucher: thank you (buyer)",
    group: "Gift vouchers",
    sentWhen: "Someone buys a gift voucher online or at the desk. The voucher PDF is attached.",
    to: "voucher buyer",
    subject: "Thank you: your Northbank gift voucher ({amount})",
    body:
      "Hi {first_name},\n\n" +
      "Thank you for buying a Northbank gift voucher.\n\n" +
      "{delivery}\n\n" +
      "{voucher_details}\n\n" +
      "{how_to_use}\n\n" +
      "{terms}\n\n" +
      SIGN_OFF,
    note: "{voucher_details} is the written confirmation of the purchase date, expiry date and how long the voucher can be used for that the law requires, so it can't be removed.",
    vars: [
      { ...FIRST, label: "Buyer's first name" },
      AMOUNT,
      { name: "code", label: "Voucher code", sample: "NB-7KQ2-9XTD" },
      { name: "delivery", label: "Where the voucher went (to them, to the person it's for, or on a set day)", sample: "We've emailed the voucher to Sarah at sarah@example.com. A copy is attached for you too." },
      { name: "voucher_details", label: "Code, value, date bought and valid until (required by law)", sample: "Voucher code: NB-7KQ2-9XTD\nValue: €100.00\nBought: 31 October 2026\nValid until: 31 October 2031. It can be used any time from the day it was bought until then." },
      { name: "how_to_use", label: "How to use it", sample: "To book, call us on 01 555 0100 or email hello@northbank.example and quote the code. Use it towards any treatment at Northbank, in one visit or several. Whatever is left stays on the voucher until it expires." },
      { name: "terms", label: "Keep the code safe", sample: "Keep the code safe: anyone who has it can use it. Lost it? We can send it again to the email it was sent to." },
    ],
    required: { body: ["voucher_details"] },
  }),
  voucher_resend: t({
    name: "Gift voucher: sent again (buyer)",
    group: "Gift vouchers",
    sentWhen: "Reception sends a gift voucher again to the person who bought it.",
    to: "voucher buyer",
    subject: "Your Northbank gift voucher {code} ({amount})",
    body:
      "Hi {first_name},\n\n" +
      "Here is your Northbank gift voucher again.\n\n" +
      "{delivery}\n\n" +
      "{voucher_details}\n\n" +
      "{how_to_use}\n\n" +
      "{terms}\n\n" +
      SIGN_OFF,
    note: "{voucher_details} is the written confirmation of the purchase date, expiry date and how long the voucher can be used for that the law requires, so it can't be removed.",
    vars: [
      { ...FIRST, label: "Buyer's first name" },
      AMOUNT,
      { name: "code", label: "Voucher code", sample: "NB-7KQ2-9XTD" },
      { name: "delivery", label: "Where the voucher went", sample: "The voucher is attached as a PDF, ready to print or forward." },
      { name: "voucher_details", label: "Code, value, date bought and valid until (required by law)", sample: "Voucher code: NB-7KQ2-9XTD\nValue: €100.00 (€35.00 left)\nBought: 31 October 2026\nValid until: 31 October 2031. It can be used any time from the day it was bought until then." },
      { name: "how_to_use", label: "How to use it", sample: "To book, call us on 01 555 0100 or email hello@northbank.example and quote the code. Use it towards any treatment at Northbank, in one visit or several. Whatever is left stays on the voucher until it expires." },
      { name: "terms", label: "Keep the code safe", sample: "Keep the code safe: anyone who has it can use it. Lost it? We can send it again to the email it was sent to." },
    ],
    required: { body: ["voucher_details"] },
  }),
  voucher_recipient: t({
    name: "Gift voucher: for the person it's for",
    group: "Gift vouchers",
    sentWhen: "The buyer chose to have the voucher emailed to the person it's for (straight away or on a set day). The voucher PDF is attached.",
    to: "voucher recipient",
    subject: "{buyer_first_name} sent you a Northbank gift voucher ({amount})",
    body:
      "Hi {first_name},\n\n" +
      "{buyer_name} has sent you a {amount} gift voucher for Northbank Physio in Dublin 2.\n\n" +
      'Their message: "{message}"\n\n' +
      "{voucher_details}\n\n" +
      "{how_to_use}\n\n" +
      "Your voucher is attached as a PDF, ready to print.\n\n" +
      "{terms}\n\n" +
      SIGN_OFF,
    vars: [
      { ...FIRST, label: "Their first name" },
      { name: "buyer_name", label: "Buyer's full name", sample: "John Murphy", fallback: "Someone" },
      { name: "buyer_first_name", label: "Buyer's first name", sample: "John", fallback: "Someone" },
      AMOUNT,
      { name: "message", label: "The buyer's message", sample: "Happy birthday! Enjoy a massage.", optional: true },
      { name: "voucher_details", label: "Code, value, date bought and valid until", sample: "Voucher code: NB-7KQ2-9XTD\nValue: €100.00\nBought: 31 October 2026\nValid until: 31 October 2031. It can be used any time from the day it was bought until then." },
      { name: "how_to_use", label: "How to use it", sample: "To book, call us on 01 555 0100 or email hello@northbank.example and quote the code. Use it towards any treatment at Northbank, in one visit or several. Whatever is left stays on the voucher until it expires." },
      { name: "terms", label: "Keep the code safe", sample: "Keep the code safe: anyone who has it can use it. Lost it? We can send it again to the email it was sent to." },
    ],
    required: { body: ["voucher_details"] },
  }),

  // ---------------- Invoices
  invoice: t({
    name: "Invoice",
    group: "Invoices",
    sentWhen: "The Hub emails a paid invoice to a patient. The invoice PDF is attached.",
    to: "patient",
    subject: "Invoice #{invoice_number} - {company}",
    body:
      "Hi {first_name},\n\n" +
      "Attached is your invoice from {company} for {what}.\n\n" +
      "This invoice has already been paid. Your therapist's registration numbers are on it if you're claiming from your health insurer.\n\n" +
      "Thank you,\n{company}",
    note: "Keep these close to Cliniko's own invoice emails (Settings > Invoice settings), so patients get one style from both.",
    vars: [FIRST, { name: "invoice_number", label: "Invoice number", sample: "1042" }, COMPANY_NAME, { name: "what", label: "Treatment and date", sample: "Physiotherapy on 13 October 2026" }],
  }),
  credit_note: t({
    name: "Credit note",
    group: "Invoices",
    sentWhen: "The Hub emails a credit note after a refund. The PDF is attached.",
    to: "patient",
    subject: "Credit note #{credit_number} - {company}",
    body:
      "Hi {first_name},\n\n" +
      "Attached is your credit note from {company} for the refund of {amount} for {what} (invoice #{invoice_number}).\n\n" +
      "The refund goes back to the card you paid with. It can take 5–10 working days to show on your statement.\n\n" +
      "Thank you,\n{company}",
    vars: [
      FIRST,
      { name: "credit_number", label: "Credit note number", sample: "1043" },
      { name: "invoice_number", label: "Original invoice number", sample: "1042" },
      COMPANY_NAME,
      AMOUNT,
      { name: "what", label: "Treatment and date", sample: "Physiotherapy on 13 October 2026" },
    ],
  }),

  // ---------------- Sign-in and staff
  code: t({
    name: "Verification code",
    group: "Sign-in and staff",
    sentWhen: "A patient asks for a code (returning patient, Manage a booking) or staff sign in to the dashboard with an emailed code.",
    to: "patient",
    subject: "{code} is your Northbank verification code",
    body: "Your Northbank verification code is {code}.\n\n" + "Enter it on {where}. It expires in ten minutes.\n\n" + "If you didn't ask for this, you can ignore this email.",
    note:
      "Keep the words \"verification code\" next to the code, keep it short, and don't add any other numbers (like a phone number): that's how iPhones and Gmail offer to fill the code in automatically.",
    vars: [
      { name: "code", label: "The code", sample: "482913" },
      { name: "where", label: "Where to enter it", sample: "the Manage a booking page" },
    ],
    required: { subject: ["code"], body: ["code"] },
  }),
  manage_none: t({
    name: "No upcoming appointments",
    group: "Sign-in and staff",
    sentWhen: "Someone asks for a code on Manage a booking, but nobody on that email has an upcoming appointment. Sent instead of the code, so they aren't left waiting for one.",
    to: "patient",
    subject: "No upcoming appointments found - Northbank",
    body:
      "Hi,\n\n" +
      "You asked to manage a booking at Northbank with this email address, but we can't find any upcoming appointments for it.\n\n" +
      "If you booked with a different email address, try that one on the Manage a booking page. If you think this is wrong, call us on {clinic_phone}.\n\n" +
      "If you didn't ask for this, you can ignore this email.",
    button: "Book an appointment",
    note: "This email is how someone without a booking finds out. The page itself never says whether an email has bookings, so nobody can check whether someone else is a patient.",
    vars: [PHONE],
  }),
  staff_invite: t({
    name: "Added to the dashboard",
    group: "Sign-in and staff",
    sentWhen: "An owner adds someone on the Team page.",
    to: "staff",
    subject: "You've been added to the Northbank dashboard",
    body:
      "Hi {first_name},\n\n" +
      "{added_by} has added you to the Northbank dashboard as {role}.\n\n" +
      "To sign in, open the dashboard and enter this email address. We'll email you a code, then help you set up Face ID or your fingerprint so next time it's one tap.",
    button: "Open the dashboard",
    vars: [
      { name: "first_name", label: "Their first name", sample: "Lucy", fallback: "there" },
      { name: "added_by", label: "Who added them", sample: "Clare" },
      { name: "role", label: "Their role", sample: "therapist" },
    ],
  }),
  new_device: t({
    name: "New phone waiting to be approved",
    group: "Sign-in and staff",
    sentWhen: "Someone sets up Face ID or a fingerprint for a staff member's sign-in on a new device.",
    to: "staff",
    subject: "A new device is waiting to join your Northbank sign-in",
    body:
      "{device} has just set up Face ID for your Northbank dashboard sign-in.\n\n" +
      "It can't sign in until you approve it: open the dashboard on a phone or computer you've already set up, sign in with Face ID or your fingerprint, and press Approve.\n\n" +
      'If this wasn\'t you, press "It wasn\'t me" there instead, and tell a clinic owner.',
    button: "Open the dashboard",
    vars: [{ name: "device", label: "The device", sample: "iPhone (Safari)" }],
  }),
  new_computer: t({
    name: "New computer waiting to be approved",
    group: "Sign-in and staff",
    sentWhen: "Someone signs in to a staff member's dashboard on a new computer with an emailed code.",
    to: "staff",
    subject: "A new computer or phone is waiting to join your Northbank sign-in",
    body:
      "{device} has just signed in to the Northbank dashboard with an emailed code.\n\n" +
      "It only opens the guides until it's approved: open the dashboard on a phone or computer you've already set up, and press Approve. Or ask a clinic owner to approve it on the Team page.\n\n" +
      'If this wasn\'t you, press "It wasn\'t me" there instead, and tell a clinic owner.',
    button: "Open the dashboard",
    vars: [{ name: "device", label: "The computer", sample: "Mac (Chrome)" }],
  }),

  // ---------------- Clinic emails
  clinic_alert: t({
    name: "Alert to the clinic",
    group: "Clinic emails",
    sentWhen: "Something needs a person (a payment that couldn't be booked, a fee that couldn't be charged…). Goes to the clinic's alert inbox.",
    to: "clinic",
    subject: "[Online booking] {alert}",
    body: "{details}",
    note: "The Hub writes the details of each alert itself. You can add words before or after them, or change the start of the subject.",
    vars: [
      { name: "alert", label: "What happened", sample: "Late cancellation fee could NOT be charged" },
      { name: "details", label: "The details", sample: "Mary Murphy — Physiotherapy, Tuesday 13 October, 10:30am\nAlready paid: €20.00. Still owed: €45.00.\nPlease collect this from the patient another way." },
    ],
    required: { subject: ["alert"], body: ["details"] },
  }),
  daily_summary: t({
    name: "End-of-day payments summary",
    group: "Clinic emails",
    sentWhen: "Every evening, to the clinic's alert inbox: what was taken and refunded online that day.",
    to: "clinic",
    subject: "Northbank online payments — {day}",
    body: "{summary}",
    vars: [
      { name: "day", label: "The day", sample: "Saturday 31 October" },
      { name: "summary", label: "The day's figures", sample: "Taken: €420.00 (6 payments)\nRefunded: €65.00 (1)" },
    ],
    required: { body: ["summary"] },
  }),
} as const;

export type EmailTemplateId = keyof typeof EMAIL_TEMPLATES;
export const EMAIL_TEMPLATE_IDS = Object.keys(EMAIL_TEMPLATES) as EmailTemplateId[];
export const isEmailTemplateId = (v: unknown): v is EmailTemplateId => typeof v === "string" && Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, v);

/** The values a template needs, by placeholder name. */
export type EmailValues<K extends EmailTemplateId> = { [N in (typeof EMAIL_TEMPLATES)[K]["vars"][number]["name"]]: string | null | undefined };

/** A change saved on the dashboard. */
export type EmailOverride = { subject: string; body: string; button?: string; updatedAt?: string; updatedBy?: string };
export type EmailOverrides = Partial<Record<EmailTemplateId, EmailOverride | null>>;

export const LIMITS = { subject: 200, body: 6000, button: 60 } as const;

const PLACEHOLDER = /\{([a-z0-9_]+)\}/g;
const placeholdersIn = (s: string) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]);

/** What's wrong with a draft, in words for the dashboard. Empty when it can be saved. */
export function checkTemplate(id: EmailTemplateId, draft: { subject: string; body: string; button?: string }): string[] {
  const def: EmailTemplateDef = EMAIL_TEMPLATES[id];
  const known = new Set(def.vars.map((v) => v.name));
  const problems: string[] = [];
  const subject = draft.subject ?? "";
  const body = draft.body ?? "";
  if (!subject.trim()) problems.push("The subject can't be empty.");
  if (/[\r\n]/.test(subject)) problems.push("The subject must be on one line.");
  if (subject.length > LIMITS.subject) problems.push(`The subject is too long (${LIMITS.subject} characters at most).`);
  if (!body.trim()) problems.push("The email can't be empty.");
  if (body.length > LIMITS.body) problems.push(`The email is too long (${LIMITS.body} characters at most).`);
  if (def.button !== undefined) {
    const b = draft.button ?? "";
    if (!b.trim()) problems.push("The button needs some words.");
    if (b.length > LIMITS.button) problems.push(`The button is too long (${LIMITS.button} characters at most).`);
  }
  const unknown = new Set([...placeholdersIn(subject), ...placeholdersIn(body), ...placeholdersIn(def.button !== undefined ? draft.button ?? "" : "")].filter((n) => !known.has(n)));
  for (const n of unknown) problems.push(`{${n}} isn't one of this email's placeholders. Check the spelling, or pick one from the list.`);
  for (const n of def.required?.subject ?? []) if (!placeholdersIn(subject).includes(n)) problems.push(`The subject must keep {${n}}.`);
  for (const n of def.required?.body ?? []) if (!placeholdersIn(body).includes(n)) problems.push(`The email must keep {${n}}.`);
  return problems;
}

/** Fills a template's placeholders; paragraphs with an empty optional placeholder are left out. */
export function fillText(def: EmailTemplateDef, template: string, values: Record<string, string | null | undefined>, opts: { paragraphs: boolean }) {
  const vars = new Map(def.vars.map((v) => [v.name, v]));
  const valueOf = (name: string) => {
    const raw = values[name];
    const v = raw == null ? "" : String(raw);
    return v.trim() ? v : vars.get(name)?.fallback ?? "";
  };
  const isMissing = (name: string) => !!vars.get(name)?.optional && !valueOf(name).trim();
  const sub = (s: string) => s.replace(PLACEHOLDER, (whole, name: string) => (vars.has(name) ? valueOf(name) : ""));
  // One line (subject, button): tidy what an empty value leaves behind, e.g. "Physiotherapy, – Northbank".
  if (!opts.paragraphs)
    return sub(template)
      .replace(/\s+/g, " ")
      .replace(/\s*[,;:]\s*(?=[–—-]\s|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return template
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .filter((para) => !placeholdersIn(para).some(isMissing))
    .map((para) => sub(para).replace(/[ \t]+\n/g, "\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The email's subject, words and button label: the saved change if there is
 * one and it still passes the checks, otherwise the original words.
 */
export function fillTemplate<K extends EmailTemplateId>(id: K, values: EmailValues<K>, overrides?: EmailOverrides | null): { subject: string; text: string; button: string; edited: boolean } {
  const def: EmailTemplateDef = EMAIL_TEMPLATES[id];
  const o = overrides?.[id];
  const useOverride = !!o && checkTemplate(id, o).length === 0;
  const src = useOverride ? { subject: o!.subject, body: o!.body, button: o!.button ?? def.button ?? "" } : { subject: def.subject, body: def.body, button: def.button ?? "" };
  const v = values as Record<string, string | null | undefined>;
  return {
    subject: fillText(def, src.subject, v, { paragraphs: false }),
    text: fillText(def, src.body, v, { paragraphs: true }),
    button: fillText(def, src.button, v, { paragraphs: false }),
    edited: useOverride,
  };
}

/** Sample values for the preview and the test email. */
export function sampleValues(id: EmailTemplateId): Record<string, string> {
  return Object.fromEntries(EMAIL_TEMPLATES[id].vars.map((v) => [v.name, v.sample]));
}

/** "1. Physiotherapy" (Cliniko's numbering) → "Physiotherapy"; empty → null, so the placeholder's fallback is used. */
export const treatmentName = (name?: string | null) => name?.replace(/^\d+\.\s*/, "").trim() || null;
