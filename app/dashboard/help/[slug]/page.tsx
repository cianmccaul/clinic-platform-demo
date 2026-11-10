"use client";

import { useEffect, useState } from "react";
import { Notice, SiteHeader } from "@/components/Brand";
import GuideView from "@/components/guides/GuideView";
import { BackToDashboard, StaffGate } from "@/components/dashboard/staff";
import type { Guide, ResolvedShot } from "@/core/guides/types";
import { appUrl } from "@/core/site-urls";

// Only NEXT_PUBLIC_ values reach the browser, and only when named in full.
const BOOK = appUrl({ NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL });

/** One guide on the dashboard. The API only sends it if the person's role includes it. */
export default function StaffGuidePage({ params }: { params: { slug: string } }) {
  return (
    <StaffGate permission="guides:therapist" title="Guides">
      {() => <StaffGuide slug={params.slug} />}
    </StaffGate>
  );
}

function StaffGuide({ slug }: { slug: string }) {
  const [data, setData] = useState<{ guide: Guide; shots: Record<string, ResolvedShot> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/staff/guides/${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Couldn't load this guide.");
        setData(d);
        document.title = `${d.guide.title} · Northbank dashboard`;
      })
      .catch((e) => setError(e.message ?? "Couldn't load this guide."));
  }, [slug]);

  return (
    <>
      <SiteHeader variant="staff" />
      <main id="main" className="page page-narrow">
        <BackToDashboard />
        {!data && (
          <div className="page-intro">
            <h1>Guide</h1>
          </div>
        )}
        {error && (
          <Notice tone="error" actions={<a className="btn btn-secondary" href="/dashboard/help">All guides</a>}>
            <p>{error}</p>
          </Notice>
        )}
        {!error && !data && <p className="secondary">Loading…</p>}
        {data && (
          <>
            <GuideView guide={data.guide} shots={data.shots} back={{ href: "/dashboard/help", label: "All guides" }} book={BOOK} />
            <ScrollToHash />
          </>
        )}
      </main>
    </>
  );
}

/** The guide arrives after the page loads, so jump to "#section" once it's there. */
function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  return null;
}
