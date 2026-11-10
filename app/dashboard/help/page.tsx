"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/Brand";
import { GuideList } from "@/components/guides/GuideView";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";

type Group = { audience: string; label: string; guides: { slug: string; title: string; summary: string }[] };

/**
 * Staff guides: the ones the signed-in person's role includes, from the
 * staff guides API (which checks the role). Opens on an emailed-code
 * session too, so new starters can read how to set up Face ID.
 */
export default function StaffHelpPage() {
  return (
    <StaffGate permission="guides:therapist" title="Guides">
      {() => (
        <DashboardShell title="Guides" lede="New here? Start with Start here: how Northbank works. Every guide has the steps, and most have pictures with the button to press circled." narrow>
          <GuideIndex />
        </DashboardShell>
      )}
    </StaffGate>
  );
}

function GuideIndex() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [limited, setLimited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/staff/guides", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Couldn't load the guides.");
        setGroups(d.groups);
        setLimited(!!d.limited);
      })
      .catch((e) => setError(e.message ?? "Couldn't load the guides."));
  }, []);

  if (error)
    return (
      <Notice tone="error">
        <p>{error}</p>
      </Notice>
    );
  if (!groups) return <p className="secondary">Loading…</p>;
  return (
    <div className="stack-6">
      {limited && (
        <Notice tone="warning" title="More guides after Face ID">
          <p>
            You signed in with an emailed code. Set up Face ID or fingerprint on the <a href="/dashboard">dashboard home</a> to see the guides for your
            role.
          </p>
        </Notice>
      )}
      {groups.map((g) => (
        <section key={g.audience} className="stack-3" aria-labelledby={`g-${g.audience}`}>
          <h2 id={`g-${g.audience}`}>{g.label}</h2>
          <GuideList guides={g.guides} hrefFor={(slug) => `/dashboard/help/${slug}`} />
        </section>
      ))}
    </div>
  );
}
