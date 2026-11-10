import { Notice, SiteHeader } from "@/components/Brand";
import { GuideList } from "@/components/guides/GuideView";
import { CLINIC_EMAIL, CLINIC_PHONE, CLINIC_TEL } from "@/core/policy";
import { dashboardUrl } from "@/core/site-urls";
import { PATIENT_GUIDES } from "@/core/guides/public";

/** The public help centre (help.northbank.example): patient guides only. Staff guides are on the dashboard. */
export default function HelpHome() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        <div className="page-intro">
          <h1>Help</h1>
          <p className="lede">Step-by-step guides to booking, paying and managing your appointment, with pictures.</p>
        </div>
        <div className="stack-5">
          <GuideList guides={PATIENT_GUIDES} hrefFor={(slug) => `/help/${slug}`} />
          <Notice title="Still stuck?">
            <p>
              Call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a> or email <a href={`mailto:${CLINIC_EMAIL}`}>{CLINIC_EMAIL}</a> and we&apos;ll
              help.
            </p>
          </Notice>
          <p className="secondary">
            Northbank staff: <a href={`${dashboardUrl(process.env)}/help`}>sign in to see staff guides</a>.
          </p>
        </div>
      </main>
    </>
  );
}
