import type { Guide } from "./types.ts";

/** Guides for owners. Demo content. */
export const OWNER_GUIDES: Guide[] = [
  {
    slug: "kpis",
    audience: "owner",
    title: "Clinic KPIs",
    summary: "New and returning patients, rebooking, cancellations, no-shows and revenue.",
    updated: "2026-11-10",
    blocks: [{ type: "text", text: "Open **Clinic KPIs** for the month so far, per therapist and for the whole clinic. Numbers come from the diary and the payments, recalculated each night." }],
  },
];
