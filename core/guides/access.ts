/**
 * Which permission opens which guides (pure, unit-tested). Patient guides are
 * public, but on the dashboard they still need a staff sign-in like every
 * other dashboard page.
 */
import type { Permission } from "../roles.ts";
import type { Audience } from "./types.ts";

export const GUIDE_PERMISSION: Record<Audience, Permission> = {
  patient: "guides:therapist",
  therapist: "guides:therapist",
  admin: "guides:admin",
  owner: "guides:owner",
};

/** Screenshot file names the image route will serve: plain names only, no folders. */
export function isSafeImageName(file: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.(webp|png)$/.test(file);
}
