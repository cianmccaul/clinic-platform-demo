/**
 * The Neon connection string, with sslmode spelled the way node-postgres
 * already treats it. pg 8 reads "prefer", "require" and "verify-ca" as
 * "verify-full" (check the certificate and the host name) and logs a
 * SECURITY WARNING on every cold start that pg 9 will change that. Saying
 * verify-full ourselves keeps today's behaviour, survives the pg 9 change
 * and stops the warning. Pure, unit-tested.
 */
export function pgConnectionString(url: string): string {
  return url.replace(/([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/i, "$1verify-full");
}
