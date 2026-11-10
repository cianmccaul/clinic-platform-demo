import { CLINIC_PHONE, CLINIC_TEL } from "@/core/policy";
import { SiteHeader } from "@/components/Brand";

export const metadata = { title: "Page not found · Northbank" };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        <div className="page-intro">
          <h1>We couldn&apos;t find that page</h1>
          <p className="lede">
            The link may be old or mistyped. You can call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a>, or:
          </p>
        </div>
        <div className="actions">
          <a className="btn btn-primary" href="/">
            Book an appointment
          </a>
          <a className="btn btn-secondary" href="/manage">
            Manage a booking
          </a>
        </div>
      </main>
    </>
  );
}
