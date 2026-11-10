/**
 * Whether to offer Face ID / fingerprint / PIN setup on this browser, and how
 * to ask for it (13 Oct 2026). Pure, unit-tested; the browser checks are in
 * components/dashboard/staff.tsx (AddPasskey).
 *
 * - Safari, and any browser on an iPhone or iPad (they all run on Safari's
 *   engine): always offer, and let it choose (Touch ID, Face ID, iCloud
 *   Keychain). Asking Safari for "this device only" can hang.
 * - Every other browser (Chrome, Edge, Firefox, Samsung Internet on Android,
 *   Windows, Mac, Linux): offer only when the browser says this device has
 *   its own fingerprint, face or screen-lock PIN (Android fingerprint or face
 *   unlock, Samsung Pass, Windows Hello, Touch ID). Then ask for that device's
 *   own one, so nobody is sent to a QR code or a security key.
 * - A device with none of these (many laptops, Windows without Windows Hello
 *   set up): don't offer it. The emailed code on an approved computer is a
 *   full sign-in, so nothing is lost.
 */
export type PasskeySetup = { offer: false } | { offer: true; attachment?: "platform" };

export function isSafariBrowser(userAgent: string): boolean {
  return /^((?!chrome|android|crios|fxios|edg|samsungbrowser).)*safari/i.test(userAgent);
}

export function isIosBrowser(userAgent: string): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent);
}

export function passkeySetupFor({ userAgent, platformAuthenticator }: { userAgent: string; platformAuthenticator: boolean | null }): PasskeySetup {
  if (isSafariBrowser(userAgent) || isIosBrowser(userAgent)) return { offer: true };
  // null: the browser can't tell us (very old, or no WebAuthn at all).
  if (!platformAuthenticator) return { offer: false };
  return { offer: true, attachment: "platform" };
}

/** How long to wait for the device before giving up and saying so. Long enough to read Chrome's or Samsung's "save passkey" sheet. */
export const PASSKEY_SETUP_TIMEOUT_MS = 60_000;
