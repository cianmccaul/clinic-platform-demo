# Clinic platform demo

Online booking, payments and a reception dashboard for a physiotherapy clinic.

This is a public, working copy of a platform I built for a multi-therapist clinic in Dublin. The real system has been live since October 2026, taking bookings and payments every day. Here it runs as a **fictional clinic, Northbank Physio**, with made-up patients. It's the production interface, unchanged, with a pretend back end that runs in your browser, so there are no accounts or keys and nothing is ever charged or sent.

**[How the production system works →](docs/architecture.md)**

## Try it

```
npm install
npm run dev
```

Open http://localhost:3000. The dark bar at the top has the **Demo inbox** (every email the system "sends") and **Reset demo**.

### Things to try

1. **Book an appointment.** Pick a treatment, therapist and time, fill in your details and pay on the pretend checkout page.
2. **Break it on purpose.** On the checkout page, choose *"Someone takes the time while I pay"*: you keep your payment and get a link (in the Demo inbox) to pick another time, or ask for a refund. Choose *"The clinic diary is down"*: you're refunded in full automatically.
3. **Manage a booking** as `jack.murphy@example.com`. The sign-in code arrives in the Demo inbox. Jack has one booking more than 24 hours away (free to cancel or move) and one inside 24 hours (the fee applies).
4. **Run reception** from the **Dashboard**. You're signed in as an owner, so every area shows.
   - **Online bookings**: refunds, extras, no-show and late-cancel fees, pausing online booking, the daily checks and the activity log.
   - **Appointments**: find a patient, move or cancel their appointments, and sort out patients who paid for a time that was taken.
   - **Book a patient by phone**: the patient's steps, then a payment link (open it from the Demo inbox and pay it) or their saved card.
   - **Payment for a past appointment**, **Waitlist** (offer a time by hand, or "Look for times now"), **Invoices** and **Clinic KPIs**.
5. **Look around the rest.** Machine clashes, gift vouchers, tasks, therapist stats, shifts, emails, team, timesheets and the guides are view-only, with sample data.

## What it shows

**Pay, then book, without ever losing a payment.** The time is re-checked and held while the patient pays, then re-checked again when the payment lands. If it's gone, the payment is kept and the patient picks another time with the same therapist (refunded automatically after 7 days if they don't). If the diary can't be reached, they're refunded in full. Nobody is left paid but not booked.

**Safe retries.** Payment webhooks get retried. The handler ignores an event it has already processed and looks for the appointment it already made before creating one, so a retry never double-books or double-charges.

**One cancellation policy.** The 24-hour rule and its wording live in one module, used by booking, "Manage my booking", reception and every email.

**Therapists paid directly.** Each payment is a direct charge on the therapist's own Stripe account, because they're self-employed and the money is theirs. The one therapist employed by the clinic is paid on the clinic's account.

**One machine, one booking.** There's one shockwave machine and one laser, so the Hub never offers a time when the machine is in use, and a dashboard page catches clashes made straight in the diary.

**Money in cents, time in Irish time.** Amounts are whole cents end to end. Every date is an Irish calendar day, including when the clocks change.

## How the demo works

The pages and components in `app/`, `components/` and `core/` are the production code, with the clinic's name, staff and details swapped for fictional ones. They call `/api/...` exactly as they do in production. In the demo, `demo/install.ts` answers those calls in the browser instead, from `demo/server/`, which follows the production route handlers and keeps everything in local storage. Each visitor gets their own clinic, rebuilt every day.

```
app/, components/        the production pages and components
core/                    the production business logic: pure, no I/O
  policy.ts              the 24-hour rule, its wording, money helpers
  waitlist.ts            who gets offered a time, and when
  machines.ts            shockwave and laser capacity, clash finding
  kpi2.ts, kpi2-report   the KPI report (it runs on the demo diary here)
  ...
lib/                     type-only stand-ins for the server modules
demo/
  install.ts             answers the pages' /api calls in the browser
  DemoBar.tsx            the demo bar, Demo inbox and reset
  server/
    flows.ts             pay-then-book, the webhook, rebook, refunds, cancelling
    diary.ts             stands in for Cliniko: availability, holds, appointments
    stripe.ts            stands in for Stripe: charges and refunds per account
    paylinks.ts          phone bookings and waitlist offers
    kpis.ts              feeds the real KPI report from the demo diary
    seed.ts              a believable month of made-up data
    routes/              the /api routes: patient, reception, money, waitlist, view-only
app/demo-checkout/       the pretend Stripe page, with "simulate a problem"
tests/                   the demo server end to end, plus the production unit tests for core/
docs/architecture.md     how the real system is designed
```

## Tests

```
npm test
```

`tests/demo-server.test.ts` runs the flows through the API: a paid booking, a repeated webhook, a time taken mid-payment (payment kept, rebooked, or refunded after 7 days), the diary down, the 24-hour rule both ways, refund limits, phone pay links, waitlist offers and the machine rule. `tests/core/` holds the production unit tests for the shared logic (policy, waitlist, KPIs, invoices, roles and more), unchanged apart from the clinic's details.

## Built with

Next.js 14, React 18, TypeScript and plain CSS with design tokens. The production system also uses Stripe Connect, the Cliniko API, Upstash Redis, Postgres, Better Auth with passkeys, Resend and Twilio. See [docs/architecture.md](docs/architecture.md).

---

Built by [Cian McCaul](https://github.com/cianmccaul).
