/**
 * Newsletter sign-up (decision 20 Oct 2026). Only patients who tick the
 * unticked box on the payment screen are added to MailerLite. (Demo: the
 * clinic's own mailing-list groups are left out.)
 */

export const MARKETING_OPT_IN_LABEL = "Send me Northbank's newsletter, exclusive offers and a birthday treat.";
export const MARKETING_OPT_IN_HINT = "Optional. You can unsubscribe at any time.";

/** A date of birth fit for MailerLite's date field (YYYY-MM-DD), or undefined. */
export function birthdayField(dateOfBirth: string | null | undefined): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth ?? "");
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1900) return undefined;
  return dateOfBirth!;
}
