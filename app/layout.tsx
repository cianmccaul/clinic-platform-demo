// One typeface, self-hosted (app/fonts, declared in tokens.css): nothing
// loads from Google Fonts or any third party on the booking or payment pages.
import "./tokens.css";
import "./globals.css";
import "./demo.css";
import { DemoBar } from "@/demo/DemoBar";
import { CLINIC_EMAIL, CLINIC_PHONE, CLINIC_TEL, PRIVACY_URL } from "@/core/policy";
import { CLINIC_ADDRESS } from "@/core/format";
import { appUrl, helpUrl } from "@/core/site-urls";
import { voucherSalesOn } from "@/core/vouchers";

export const metadata = {
  title: "Book an appointment · Northbank",
  description: "Demo of an online booking, payments and reception system for a fictional physio clinic.",
};

export const viewport = {
  themeColor: "#F2F7F5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Absolute, so the footer works on the dashboard and help addresses too.
  const book = appUrl(process.env);
  return (
    <html lang="en-IE">
      <body>
        <DemoBar />
        {children}
        <footer className="site-footer">
          <div className="site-footer-inner">
            <div className="footer-top">
              <div className="footer-brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/northbank-wordmark.svg" alt="Northbank" width={89} height={32} />
                <address>
                  Northbank Physio
                  <br />
                  {CLINIC_ADDRESS}
                </address>
                <p className="footer-contact">
                  <a href={CLINIC_TEL}>{CLINIC_PHONE}</a>
                  <a href={`mailto:${CLINIC_EMAIL}`}>{CLINIC_EMAIL}</a>
                </p>
              </div>
              <nav className="footer-col" aria-labelledby="footer-booking">
                <h2 id="footer-booking">Bookings</h2>
                <ul>
                  <li>
                    <a href={`${book}/`}>Book an appointment</a>
                  </li>
                  <li>
                    <a href={`${book}/manage`}>Manage a booking</a>
                  </li>
                  {voucherSalesOn(process.env) && (
                    <li>
                      <a href={`${book}/vouchers`}>Gift vouchers</a>
                    </li>
                  )}
                  <li>
                    <a href={`${book}/cancellation-policy`}>Cancellation policy</a>
                  </li>
                  <li>
                    <a href={helpUrl(process.env)}>Help centre</a>
                  </li>
                </ul>
              </nav>
              <nav className="footer-col" aria-labelledby="footer-clinic">
                <h2 id="footer-clinic">Northbank</h2>
                <ul>
                  <li>
                    <a href="https://northbank.example">northbank.example</a>
                  </li>
                  <li>
                    <a href={PRIVACY_URL}>Privacy</a>
                  </li>
                  <li>
                    <a href={CLINIC_TEL}>Call reception</a>
                  </li>
                </ul>
              </nav>
            </div>
            <div className="footer-bottom">
              <p className="footer-secure">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                <span>Card payments are secured by Stripe. Northbank never sees your full card number.</span>
              </p>
              <p>© {new Date().getFullYear()} Northbank</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
