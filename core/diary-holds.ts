/**
 * The note on a payment-link hold in the therapist's Cliniko diary
 * (lib/diary-holds.ts). Name and time only: no treatment or health detail.
 * Pure, unit-tested in tests/diary-holds.test.ts.
 */
import { timeShort } from "./format.ts";

export function holdNote(p: { firstName: string; lastName: string; expiresAtISO: string; source: "reception" | "waitlist" }) {
  const who = `${p.firstName} ${p.lastName ? `${p.lastName.trim()[0]}.` : ""}`.trim();
  const why = p.source === "waitlist" ? "waitlist offer" : "payment link sent";
  return (
    `HELD for ${who} (${why}) until ${timeShort(p.expiresAtISO)}. ` +
    `Northbank Hub removes this by itself when they pay (the appointment then appears here) or when the hold runs out. ` +
    `Please don't book over it; to free the time, cancel the link on the dashboard.`
  );
}
