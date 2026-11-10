"use client";

/**
 * Demo stand-in for the staff sign-in client (Better Auth with passkeys).
 * In the demo you're always signed in as reception, so these calls just succeed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = { data: any; error: any };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ok = async (..._args: unknown[]): Promise<Result> => ({ data: {}, error: null });

export const authClient = {
  signOut: ok,
  signIn: { passkey: ok, emailOtp: ok },
  emailOtp: { sendVerificationOtp: ok, verifyEmail: ok },
  passkey: { addPasskey: ok, listUserPasskeys: async () => ({ data: [], error: null }), deletePasskey: ok },
};
