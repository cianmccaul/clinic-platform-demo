# How the production system works

This demo is a public version of a platform I built for a multi-therapist physiotherapy clinic in Dublin. It's been live since October 2026, taking real bookings and payments every day. The production code is private because it's tied to the clinic's accounts. This page explains how it's designed, and which parts of the demo mirror it.

## What it does

- **Patients** book and pay online, sign in with an emailed code to cancel or move under the 24-hour policy, buy gift vouchers, and join a waitlist.
- **Reception** runs the day from one dashboard: payments, refunds, no-show and late-cancellation fees, phone bookings with pay links, extra treatments, timesheets and tasks.
- **Therapists** are paid directly into their own payment accounts, and get monthly rent invoices.
- **Owners** see KPIs, a daily payments summary, and every action in an audit log.
- **Everyone** has a help centre with step-by-step guides, so the clinic can run the system without its developer.

## Systems of record

| System | Owns |
| --- | --- |
| Practice management system (Cliniko) | Patients, practitioners, availability, appointments |
| Stripe | Cards, payments, refunds, payouts |
| The platform (Redis, then Postgres) | Slot holds, idempotency claims, booking records linking an appointment to its payments, the audit log, staff accounts, vouchers |

The platform never keeps its own copy of the diary. It asks the practice management system every time, so there's one source of truth for "who is booked when". Because people can still change things directly in the diary or in Stripe, a **reconciliation job runs every morning** and emails a list of anything that doesn't match, only when something needs a human.

## Taking payment, then booking

The hardest problem in an online booking system is a patient who has **paid but isn't booked**, or is **booked twice**. The flow is designed so neither can happen:

1. **Hold the slot.** Before the patient pays, the server re-checks the time with the diary and holds it for about 30 minutes, so two people can't pay for the same slot.
2. **Take payment** through Stripe Checkout, with the card saved for the cancellation policy.
3. **Book from the webhook.** When Stripe reports the payment, the webhook handler:
   - re-checks the slot. If it's gone (someone booked it by phone while they paid), it **keeps the payment** and emails a link to pick another time with the same therapist, or ask for a refund. If they do neither within 7 days, they're **refunded in full automatically**. Reception sees these on the Appointments page and can book or refund them too. (Until 3 Nov 2026 it refunded straight away; patients preferred not having to pay twice.)
   - finds or creates the patient record,
   - **looks before it creates**: if an earlier attempt already made the appointment, it uses that one instead of making a duplicate,
   - saves the booking record, then sends the confirmation.
4. **Retries and compensation.** If the diary is down, Stripe retries the webhook for up to two hours. If it still fails, the patient is **refunded in full, emailed, and the clinic alerted**.
5. **The confirmation page tells the truth.** It polls the booking status rather than assuming success.

Every Stripe call that moves money uses an **idempotency key**, and every webhook event is claimed once, so a retried request can never charge twice.

*In the demo:* `demo/server/flows.ts` runs this same sequence, and the "simulate a problem" choice on the pretend checkout page triggers the slot-taken and diary-down paths. `tests/demo-server.test.ts` checks that a repeated webhook gives one appointment and one charge, and that an unused rebook is refunded after 7 days.

**Why not authorise first and capture later?** Card authorisations expire after about seven days, and many bookings are further out than that. It would have needed a second flow anyway, so I chose capture-then-book with automatic compensation, plus monitoring.

## Therapists paid directly

Therapists are self-employed, so the money is theirs, not the clinic's. Each therapist has their own Stripe account, and a booking with them is a **direct charge** on that account:

- the money is the therapist's the moment the patient pays, and paid out to their bank on Stripe's normal schedule,
- the therapist pays their own card fees,
- refunds, saved cards and webhooks live on the therapist's account (a separate Connect webhook endpoint),
- payments only route to a therapist once their account can take charges and is set up to pay its own fees. Until then they go to the clinic,
- one therapist is employed by the clinic, so her appointments are booked by phone only and paid on the clinic's account.

Gift vouchers are the one exception: they're sold on the clinic's account, because nobody knows which therapist a voucher will be used with.

## The cancellation policy lives in one place

One module holds the 24-hour rule and its exact wording. The booking screens, "Manage my booking", reception, the emails and the policy page all use it, so a patient never reads two versions of the rule. *In the demo:* `core/policy.ts`, the production file.

## Booking by phone, and the waitlist

Reception books a phone caller through the same five steps as the website, then either charges the card the patient saved with that therapist (after reading them the amount and policy) or sends a **payment link**. The link holds the time for 2 hours, in the Hub and as a block in the therapist's Cliniko diary; the appointment is only made once it's paid, by the same webhook as an online booking.

The **waitlist** uses the same links. When a time opens that fits someone's days, times and therapist, they're offered it (by text once texts are on, email until then) with 2 hours to pay. Named-therapist lists come before "any therapist", then whoever has waited longest without an offer. There are daily and weekly caps, and three ignored offers in a row pause their place.

## Shared machines

There's one shockwave machine and one laser. Both the online availability and reception's booking check that the machine is free for the whole appointment, across all therapists, so the Hub can't double-book it. Appointments made straight in Cliniko can, so a dashboard page lists any overlaps in the next 7 days.

## Staff sign-in and security

- Every member of staff signs in as themselves, with **roles** (therapist, reception, owner, super admin) enforced on the server and unit-tested. For example, nobody can change their own access, and there's always at least one owner.
- **Passkeys** (Face ID, fingerprint) are required for anyone who can move money. An emailed code alone only opens the guides.
- A **new device** has to be approved from a device that's already trusted.
- Every API route validates its input with Zod and checks permissions itself.
- An append-only **audit log** records who did what, with staff names but never patient details.
- Payment pages run on their own subdomain with a strict Content Security Policy, away from the clinic's WordPress site.
- A **kill switch** pauses online booking in one click. Patients see "please call" and no payments are taken.

## Operations

- **Daily jobs**: reconciliation in the morning and a payments summary in the evening.
- **Waitlist sweep**: when a slot opens, people on the waitlist are offered it by text, with a two-hour window to accept.
- **Health endpoint** for uptime monitoring, plus a runbook for when things go wrong.
- **CI**: type checking, unit tests and a production build on every push.

## Engineering process

Before launch I wrote requirements, a **failure modes and effects analysis (FMEA)** of everything that could go wrong with money and bookings, a test plan, a go/no-go checklist, a runbook, and **architecture decision records** for each major choice: systems of record, pay-then-book, storage, staff sign-in, direct charges and vouchers.

## The production stack

Next.js and TypeScript on Vercel (Dublin region) · Stripe and Stripe Connect · Cliniko API · Upstash Redis · Neon Postgres (EU) · Better Auth with passkeys · Resend (email) · Twilio (SMS) · pdf-lib (invoices and vouchers) · Zod · GitHub Actions.

## What's in this demo, and what isn't

| Production | This demo |
| --- | --- |
| Pages, components, business logic (`core/`) | The production code, with fictional clinic details |
| Server routes in `app/api` | `demo/server/routes`, answering the same requests with the same shapes, in the browser |
| Cliniko API | `demo/server/diary.ts`: availability, holds and appointments with the same rules |
| Stripe and Connect | `demo/server/stripe.ts` and a pretend checkout page, with per-therapist accounts |
| Redis and Postgres | The browser's local storage, so each visitor gets their own clinic |
| Resend and Twilio | The Inbox in the demo bar. No texts in the demo, so offers and links go by email |
| Passkey staff sign-in | Skipped: you're signed in as an owner |
| Bookings, appointments, phone bookings, saved cards, pay links, past-visit payments, waitlist, invoices, KPIs | Working |
| Vouchers, tasks, therapist stats, shifts, emails, team, timesheets, machine clashes | View-only, with sample data |
| Card taken over the phone (Stripe Elements), gift voucher sales, PDFs | Not in the demo |
