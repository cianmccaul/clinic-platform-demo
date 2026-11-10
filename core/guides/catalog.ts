/**
 * Every guide, for the staff guides API only (app/api/staff/guides). Server
 * side: never import this from a public page or a client component, because
 * it contains the staff guides (tests/guides.test.ts checks). Public pages use
 * core/guides/public.ts.
 */
import { AUDIENCES, type Audience, type Guide, type ResolvedShot } from "./types.ts";
import { PATIENT_GUIDES } from "./patient.ts";
import { THERAPIST_GUIDES } from "./therapist.ts";
import { CLINIKO_GUIDES } from "./cliniko.ts";
import { START_HERE_GUIDES } from "./start-here.ts";
import { ADMIN_GUIDES } from "./admin.ts";
import { ANSWERING_SERVICE_GUIDES } from "./answering-service.ts";
import { OWNER_GUIDES } from "./owner.ts";
import { SHOTS } from "./shots.ts";

export const ALL_GUIDES: Guide[] = [...PATIENT_GUIDES, ...START_HERE_GUIDES, ...THERAPIST_GUIDES, ...CLINIKO_GUIDES, ...ADMIN_GUIDES, ...ANSWERING_SERVICE_GUIDES, ...OWNER_GUIDES];

export function findGuide(slug: string): Guide | null {
  return ALL_GUIDES.find((g) => g.slug === slug) ?? null;
}

export function guidesFor(audiences: readonly Audience[]): Guide[] {
  return ALL_GUIDES.filter((g) => audiences.includes(g.audience));
}

/** Every screenshot id a guide uses, in order. */
export function shotIdsIn(guide: Guide): string[] {
  const ids: string[] = [];
  for (const b of guide.blocks) {
    if (b.type === "steps") for (const s of b.steps) if (s.shot) ids.push(s.shot.id);
    if (b.type === "picture") ids.push(b.shot.id);
  }
  return ids;
}

export const PUBLIC_IMAGE_BASE = "/guide-img/";
export const STAFF_IMAGE_BASE = "/api/staff/guides/image/";

/** The screenshots a guide needs, with where to load each one. Missing captures are simply left out. */
export function resolveShots(guide: Guide): Record<string, ResolvedShot> {
  const out: Record<string, ResolvedShot> = {};
  for (const id of shotIdsIn(guide)) {
    const s = SHOTS[id];
    if (s) out[id] = { ...s, src: (s.public ? PUBLIC_IMAGE_BASE : STAFF_IMAGE_BASE) + s.file };
  }
  return out;
}

/**
 * Who may load a staff screenshot: the least-restricted audience of the
 * guides that show it. null if no guide uses it, or it's a public picture
 * (those are served as plain files).
 */
export function staffImageAudience(file: string): Audience | null {
  let best: number | null = null;
  for (const g of ALL_GUIDES) {
    for (const id of shotIdsIn(g)) {
      const s = SHOTS[id];
      if (!s || s.public || s.file !== file) continue;
      const rank = AUDIENCES.indexOf(g.audience);
      if (best === null || rank < best) best = rank;
    }
  }
  return best === null ? null : AUDIENCES[best];
}
