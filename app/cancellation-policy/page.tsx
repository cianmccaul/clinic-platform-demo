import { CANCEL_WINDOW_HOURS, CLINIC_PHONE, CLINIC_TEL, EXTRAS_SENTENCE, POLICY_SENTENCE } from "@/core/policy";
import { SiteHeader } from "@/components/Brand";

export const metadata = { title: "Cancellation policy · Northbank" };

/** Plain language, headings as the questions patients actually ask. Same core sentence as the booking screens. */
export default function CancellationPolicyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        <div className="page-intro">
          <h1>Cancellation policy</h1>
          <p className="lede">{POLICY_SENTENCE}</p>
        </div>
        <section className="prose">
          <h2>Can I change my time?</h2>
          <p>
            Yes. More than {CANCEL_WINDOW_HOURS} hours before your appointment, you can change it free of charge at{" "}
            <a href="/manage">Manage a booking</a>. Anything you&apos;ve paid carries over to the new time. Within {CANCEL_WINDOW_HOURS} hours,
            please call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a>.
          </p>

          <h2>Can I cancel?</h2>
          <p>
            Yes. More than {CANCEL_WINDOW_HOURS} hours before, cancelling is free and your payment is refunded in full. Within{" "}
            {CANCEL_WINDOW_HOURS} hours you can still cancel online, but the full appointment fee applies, so the payment you made when you
            booked isn&apos;t refunded.
          </p>

          <h2>What if I miss my appointment?</h2>
          <p>Missed appointments are charged the full appointment fee. You paid it when you booked, so there&apos;s nothing more to pay and nothing is refunded.</p>

          <h2>What if I&apos;m sick, or there&apos;s an emergency?</h2>
          <p>
            Call us as soon as you can on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a>. If you had a genuine emergency, please get in touch.
          </p>

          <h2>When do I pay?</h2>
          <p>
            You pay the full appointment fee when you book, so there&apos;s nothing to pay at the clinic. {EXTRAS_SENTENCE}
          </p>

          <h2>How long does a refund take?</h2>
          <p>Refunds go back to the card you paid with. They can take 5 to 10 working days to appear on your statement.</p>

          <h2>Why do you save my card?</h2>
          <p>
            When you book online, your card is saved securely by our payment provider, Stripe. Northbank never sees or stores your full card
            number. It is only used for payments you agree to: future bookings, extra treatments you agree to on the day, and fees under
            this policy.
          </p>
        </section>
      </main>
    </>
  );
}
