/**
 * The waitlist's on/off switch (3 Nov 2026: "turn off the
 * waitlist for now", during the two quiet weeks after the Cliniko switch).
 * OFF unless NEXT_PUBLIC_WAITLIST=on in Vercel (then redeploy). While off:
 * no "Join the waitlist" links, /waitlist says it's closed, joining is
 * refused, and no offers are sent (automatic or by hand). Offers already
 * sent run their course; leave/pause links keep working; nobody's place is
 * deleted, so switching it back on carries on where it left off.
 * NEXT_PUBLIC_ so the booking pages know too (read when the site is built).
 */
export const waitlistOn = (env: Record<string, string | undefined> = { NEXT_PUBLIC_WAITLIST: process.env.NEXT_PUBLIC_WAITLIST }) =>
  (env.NEXT_PUBLIC_WAITLIST ?? "").trim().toLowerCase() === "on";
export const WAITLIST_CLOSED_MESSAGE = "The waitlist is closed for now. Please call us and we'll find you a time.";
