import { notFound } from "next/navigation";
import { Notice, SiteHeader } from "@/components/Brand";
import GuideView from "@/components/guides/GuideView";
import { CLINIC_PHONE, CLINIC_TEL } from "@/core/policy";
import { appUrl } from "@/core/site-urls";
import { PATIENT_GUIDES, findPatientGuide, resolvePublicShots } from "@/core/guides/public";

/** One patient guide on the public help centre. Staff guide addresses don't exist here (404). */
export function generateStaticParams() {
  return PATIENT_GUIDES.map((g) => ({ slug: g.slug }));
}
export const dynamicParams = false;

export function generateMetadata({ params }: { params: { slug: string } }) {
  const g = findPatientGuide(params.slug);
  return g ? { title: `${g.title} · Northbank help`, description: g.summary } : {};
}

export default function PatientGuidePage({ params }: { params: { slug: string } }) {
  const guide = findPatientGuide(params.slug);
  if (!guide) notFound();
  return (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        <div className="stack-6">
          <GuideView guide={guide} shots={resolvePublicShots(guide)} back={{ href: "/help", label: "All help guides" }} book={appUrl(process.env)} />
          <Notice title="Still stuck?">
            <p>
              Call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a> and we&apos;ll sort it out with you.
            </p>
          </Notice>
        </div>
      </main>
    </>
  );
}
