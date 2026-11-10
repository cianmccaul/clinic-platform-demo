"use client";

import { useEffect } from "react";
import { CLINIC_PHONE, CLINIC_TEL } from "@/core/policy";
import { SiteHeader } from "@/components/Brand";

/**
 * Last-resort screen if a page crashes in the browser. Fail safe: tell the
 * patient plainly, give them the phone number, never leave a blank page
 * or show an error code.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Page error", error.digest ?? error.message);
  }, [error]);

  return (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        <div className="page-intro">
          <h1>Sorry, something went wrong</h1>
          <p className="lede">
            If you were paying, check your email for a confirmation before you try again. Or call us on{" "}
            <a href={CLINIC_TEL}>{CLINIC_PHONE}</a> and we&apos;ll sort it out.
          </p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <a className="btn btn-secondary" href="/">
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
