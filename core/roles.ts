/**
 * Staff roles for the dashboard (decision 9 Oct 2026, claude/decision-2026-10-09-staff-logins.md).
 * Pure, no I/O, unit-tested. Every staff API route asks `can(role, permission)`
 * on the server; the pages only use it to decide what to show.
 *
 * - therapist:  patient + therapist guides, and booking their own patients in by
 *               payment link (decision 16 Oct 2026). Never anyone else's diary,
 *               never a card over the phone, refunds or extras.
 * - admin:      reception: bookings, phone bookings, refunds, extras, pausing online booking.
 *               Not the emergency redirect to Cliniko's booking page (owners and super admins).
 * - owner:      everything, including staff and super admins. Nothing is "developer only".
 * - superadmin: the technical role (Cian now, the next developer later): everything
 *               except changing owners, so an owner can never be locked out.
 *
 * Patients have no login: book.northbank.example and the public help centre.
 */

export const ROLES = ["therapist", "admin", "owner", "superadmin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  therapist: "Therapist",
  admin: "Reception / admin",
  owner: "Owner",
  superadmin: "Super admin",
};

export const PERMISSIONS = [
  "guides:therapist",
  "guides:admin",
  "guides:owner",
  "bookings:view",
  "bookings:manage", // refund, waive, charge an extra, no-show, cancel
  "phone-booking", // book a patient by phone with any practitioner, payment links, card over the phone
  "phone-booking:own", // book a patient in with yourself only, payment link only (therapists)
  "clinic:controls", // pause online booking, run checks, recent activity
  "clinic:emergency", // send patients to Cliniko's own booking page (owners and super admins only)
  "staff:manage", // add, change and switch off staff
  "therapists:payments-setup", // create a therapist's Stripe account link
  "timesheets:all", // see, correct and export everyone's timesheets (own timesheets: a per-person switch, core/timesheets.ts)
  "tasks:use", // the Clinic Tree tasks tab: own list, give tasks to colleagues, repeating tasks (reception and up)
  "kpis:view", // the KPI dashboard: clinic and per-therapist figures (owners and super admins only)
  "vouchers:use", // gift vouchers: look one up, use it for a treatment, undo a mistake, sell one at the desk, email it again
  "vouchers:manage", // gift vouchers: refund, cancel, bring over from Vaoucher, totals owed and per therapist (owners and super admins only)
  "emails:edit", // change the words of the emails the Hub sends (reception and up, 31 Oct 2026)
  "shifts:manage", // extra working days in therapists' Cliniko diaries: alternate Saturdays, two Mondays a month… (reception and up, 31 Oct 2026)
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const RECEPTION: Permission[] = ["guides:therapist", "guides:admin", "bookings:view", "bookings:manage", "phone-booking", "phone-booking:own", "clinic:controls", "timesheets:all", "tasks:use", "vouchers:use", "emails:edit", "shifts:manage"];
const ALL: Permission[] = [...PERMISSIONS];

const GRANTS: Record<Role, readonly Permission[]> = {
  therapist: ["guides:therapist", "phone-booking:own"],
  admin: RECEPTION,
  owner: ALL,
  superadmin: ALL,
};

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && GRANTS[role].includes(permission);
}

/**
 * Roles that can move money or change staff must sign in with Face ID /
 * fingerprint / a security key (a passkey). An emailed code alone only lets
 * them set up their first passkey; see lib/staff.ts.
 */
export function needsStrongSignIn(role: Role): boolean {
  return role !== "therapist";
}

/**
 * What a role that needs a strong sign-in may open on an emailed-code
 * session: only the guides every member of staff sees (how to sign in and
 * set up Face ID). Reception and owner guides describe emergency switches
 * and who holds which login, so they need Face ID too (review, 12 Oct 2026).
 */
/**
 * Whether this action needs a strong sign-in (Face ID, or an emailed code on
 * an approved computer). Money roles always do; a therapist does for booking
 * a patient in, because that sends a payment request in the clinic's name.
 */
export function needsStrongFor(role: Role, permission: Permission): boolean {
  return needsStrongSignIn(role) || permission === "phone-booking:own";
}

export function allowedOnWeakSession(permission: Permission): boolean {
  return permission === "guides:therapist";
}

/** Which guide audiences a role sees. Patient guides are public. */
export function guideAudiences(role: Role | null | undefined): Array<"patient" | "therapist" | "admin" | "owner"> {
  const out: Array<"patient" | "therapist" | "admin" | "owner"> = ["patient"];
  if (can(role, "guides:therapist")) out.push("therapist");
  if (can(role, "guides:admin")) out.push("admin");
  if (can(role, "guides:owner")) out.push("owner");
  return out;
}

export type StaffSummary = { id: string; role: Role; active: boolean };

/**
 * May `actor` give `target` (or a new person) the role `nextRole`, or switch
 * them on/off? Rules:
 * - Only owners and super admins manage staff.
 * - Only an owner can add, change or switch off an owner or a super admin,
 *   so a super admin can never lock the owners out.
 * - Nobody changes or switches off themselves here (no accidental lock-out),
 *   except renaming: owners and super admins may change their own display
 *   name (Cian, 20 Oct 2026).
 * - The last active owner can't be removed or demoted.
 * Returns null when allowed, or the reason in plain words.
 */
export function staffChangeRefusal(args: {
  actor: StaffSummary;
  target: StaffSummary | null; // null = adding someone new
  nextRole?: Role;
  nextActive?: boolean;
  activeOwnerCount: number;
  /** The change is only a new display name. */
  nameOnly?: boolean;
}): string | null {
  const { actor, target, nextRole, nextActive, activeOwnerCount, nameOnly } = args;
  if (!actor.active || !can(actor.role, "staff:manage")) return "Only an owner or super admin can manage staff.";
  if (target && target.id === actor.id) return nameOnly ? null : "You can't change your own access. Ask another owner.";
  const touchesTopRole = (r: Role | undefined) => r === "owner" || r === "superadmin";
  if (actor.role !== "owner" && (touchesTopRole(target?.role) || touchesTopRole(nextRole))) {
    return "Only an owner can add, change or switch off an owner or super admin.";
  }
  if (target && target.role === "owner" && target.active) {
    const losesOwner = (nextRole !== undefined && nextRole !== "owner") || nextActive === false;
    if (losesOwner && activeOwnerCount <= 1) return "There must always be at least one owner. Add another owner first.";
  }
  return null;
}

/** Plain-text check for a staff email address (the server also lower-cases and trims it). */
export function normaliseStaffEmail(email: string): string {
  return email.trim().toLowerCase();
}
