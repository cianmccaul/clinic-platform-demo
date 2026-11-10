/**
 * Dashboard features owners and super admins can switch on and off per role
 * (decision 20 Oct 2026). Today: the Tasks tab, for Reception / admin,
 * Owners and Super admins (therapists never have it). Switching it off hides
 * the tile and refuses its pages and API; nobody's tasks are deleted.
 * Pure, unit-tested in tests/features.test.ts.
 */
import type { Permission, Role } from "./roles.ts";

export const TASK_ROLES = ["admin", "owner", "superadmin"] as const;
export type TaskRole = (typeof TASK_ROLES)[number];
export type TaskSwitch = Record<TaskRole, boolean>;
export const DEFAULT_TASK_SWITCH: TaskSwitch = { admin: true, owner: true, superadmin: true };

/** A stored value made safe: anything missing or odd counts as on. */
export function normaliseTaskSwitch(v: unknown): TaskSwitch {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { admin: o.admin !== false, owner: o.owner !== false, superadmin: o.superadmin !== false };
}

/** Is this permission switched off for this role right now? */
export function featureOff(permission: Permission, role: Role, tasks: TaskSwitch): boolean {
  if (permission !== "tasks:use") return false;
  return !(TASK_ROLES as readonly string[]).includes(role) || !tasks[role as TaskRole];
}
