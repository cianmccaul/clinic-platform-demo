/**
 * New phones and computers (Face ID / passkeys), 12 Oct 2026. Pure, unit-tested.
 *
 * A passkey saved on one device often isn't available on another (it depends
 * on the browser and the person's Apple or Google account), and the browser's
 * fallback, a QR code to scan with the other device, is confusing. So a new
 * device sets up its own Face ID after an emailed code, but that passkey is
 * "waiting" until it is approved:
 * - by the same person, signed in with Face ID on a device already set up;
 * - by an owner (or a super admin, for anyone but owners) on the Team page;
 * - by a device approver (reception, switched on per person on Team) for
 *   therapists and reception, on the dashboard home (10 Nov 2026).
 * A waiting passkey can't sign in. Someone who can only read a staff inbox can
 * ask, but can't approve, so the 9 Oct rule still holds: an inbox alone never
 * gives a money role a Face ID sign-in.
 */
import { can, type Role } from "./roles.ts";

/**
 * Approved computers (13 Oct 2026). Most laptops have no Face ID or
 * fingerprint, so a phone or computer can also be approved once and then
 * sign in with the emailed code alone:
 * - the first device an account has ever had (no Face ID, no approved computer,
 *   expired or not) is approved at once: the invite email is the proof, as for
 *   the first Face ID;
 * - a Face ID sign-in approves the device it's on;
 * - any other new device waits until the person (on an approved device or
 *   Face ID) or an owner approves it. Until then it only opens the guides.
 * The device is remembered by a random cookie (only a hash is stored), so
 * someone with only the inbox still can't move money.
 */

/** An approved computer unused this long stops counting (cookie lasts longer). */
export const COMPUTER_DAYS = 180;
/** Computers waiting per person, so a stolen inbox can't flood the Team page. */
export const MAX_WAITING_COMPUTERS = 3;
/** Approved computers per person. */
export const MAX_COMPUTERS = 10;
/** A computer waiting for approval this long is forgotten, so an old request can't block new ones forever. */
export const WAITING_DAYS = 7;

/** Name of the cookie that marks an approved computer ("__Host-" in production: HTTPS only, this host only). */
export function computerCookieName(production: boolean): string {
  return production ? "__Host-northbank-device" : "northbank-device";
}

/** The device token from a Cookie header, or null. Random, base64url, 43 characters. */
export function computerTokenFrom(cookieHeader: string | null | undefined, production: boolean): string | null {
  if (!cookieHeader) return null;
  const name = computerCookieName(production);
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    const v = part.slice(i + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null;
  }
  return null;
}

/**
 * Is a computer that isn't known yet approved straight away?
 * - On a Face ID session: yes (up to the cap), Face ID already proved it's them.
 * - On an emailed-code session: only the very first device of an account that
 *   has never had a Face ID or an approved computer (`approvedEver` counts
 *   expired ones too). Otherwise someone with only the inbox could become the
 *   "first" device of a person who is away, or who already has Face ID.
 */
export function newComputerStartsApproved(args: { passkeySession: boolean; approvedComputers: number; approvedEver: number; passkeys: number }): boolean {
  if (args.approvedComputers >= MAX_COMPUTERS) return false;
  if (args.passkeySession) return true;
  return args.approvedEver === 0 && args.passkeys === 0;
}

/** Waiting devices allowed per person, so a stolen inbox can't flood the Team page. */
export const MAX_WAITING_DEVICES = 3;

/**
 * A passkey added on an emailed-code session waits for approval when the
 * person already has a way to sign in strongly: a Face ID, or an approved
 * computer (any age: an expired one still means the account was set up).
 * Otherwise an inbox alone could become the account's first Face ID. The very
 * first thing on an account (nothing approved at all) doesn't wait: there is
 * nothing to approve it from; an owner can always reset someone who's lost theirs.
 */
export function newPasskeyWaits(args: { strongSession: boolean; existingPasskeys: number; approvedComputers?: number }): boolean {
  return !args.strongSession && args.existingPasskeys + (args.approvedComputers ?? 0) > 0;
}

export type DeviceActor = { id: string; role: Role; strong: boolean; /** Switched on for them on Team: may approve new devices for the team (10 Nov 2026). */ approver?: boolean };
export type DeviceOwner = { id: string; role: Role; active: boolean; /** false: an approved computer (only removable, for a lost laptop). */ waiting?: boolean };

/**
 * Roles an owner can make a "device approver" (Team page switch, 10 Nov 2026):
 * reception only. Owners and super admins can approve already; a therapist
 * never approves anyone else's sign-in.
 */
export const DEVICE_APPROVER_ROLES: readonly Role[] = ["admin"];

/** Is this person a device approver right now (the switch is on and they're still reception)? */
export function isDeviceApprover(role: Role, switchOn: boolean): boolean {
  return switchOn && DEVICE_APPROVER_ROLES.includes(role);
}

/**
 * May `actor` approve, or turn away, a waiting device on `owner`'s account?
 * Returns null when allowed, or the reason in plain words.
 * - Yourself, signed in strongly.
 * - An owner for anyone; a super admin for anyone but owners and super admins.
 * - A device approver (reception, switched on by an owner on Team, e.g. Demi
 *   and Ross at the answering service): waiting devices of therapists and reception only.
 *   Never owners or super admins, and never removing an approved computer.
 */
export function deviceDecisionRefusal(actor: DeviceActor, owner: DeviceOwner, action: "approve" | "remove" = "approve"): string | null {
  if (!actor.strong) return "Approve it from a phone or computer you've already set up (an approved computer, or one with Face ID), or ask an owner.";
  if (actor.id === owner.id) return null;
  if (!can(actor.role, "staff:manage")) {
    if (!isDeviceApprover(actor.role, !!actor.approver)) return "Only you, or an owner, can approve a new device on your account.";
    if (owner.role === "owner" || owner.role === "superadmin") return "Only an owner can approve a new device for an owner or super admin.";
    if (owner.waiting === false) return "Only an owner can remove an approved computer.";
  }
  if (!owner.active && action === "approve") return "That account is switched off.";
  if (actor.role !== "owner" && (owner.role === "owner" || owner.role === "superadmin")) {
    return "Only an owner can approve a new device for an owner or super admin.";
  }
  return null;
}

/**
 * "iPhone (Safari)", "Mac (Chrome)"… from the browser's user agent, for naming
 * a new passkey. Worked out on the server, never taken from the page, because
 * an approver relies on it and it goes in emails.
 */
export function deviceNameFrom(userAgent: string): string {
  const ua = userAgent.slice(0, 400);
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android phone"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows computer"
            : /Linux|CrOS/.test(ua)
              ? "Computer"
              : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\/|FxiOS/.test(ua)
      ? "Firefox"
      : /Chrome\/|CriOS/.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return browser ? `${device} (${browser})` : device;
}
