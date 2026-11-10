/**
 * The public help centre (help.northbank.example): patient guides only. Safe for
 * public pages. Staff guides live in core/guides/catalog.ts and are only
 * sent to signed-in staff.
 */
import type { Guide, ResolvedShot } from "./types.ts";
import { PATIENT_GUIDES } from "./patient.ts";
import { SHOTS } from "./shots.ts";

export { PATIENT_GUIDES };

export function findPatientGuide(slug: string): Guide | null {
  return PATIENT_GUIDES.find((g) => g.slug === slug) ?? null;
}

/** Patient guides only ever show public pictures (served from /guide-img/). */
export function resolvePublicShots(guide: Guide): Record<string, ResolvedShot> {
  const out: Record<string, ResolvedShot> = {};
  const add = (id: string) => {
    const s = SHOTS[id];
    if (s && s.public) out[id] = { ...s, src: `/guide-img/${s.file}` };
  };
  for (const b of guide.blocks) {
    if (b.type === "steps") for (const st of b.steps) if (st.shot) add(st.shot.id);
    if (b.type === "picture") add(b.shot.id);
  }
  return out;
}
