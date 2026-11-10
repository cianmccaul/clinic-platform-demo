/**
 * Newsletter sign-up (decision 20 Oct 2026). Only patients who tick the
 * unticked box on the payment screen are added to MailerLite. MailerLite
 * puts everyone in All subscribers; on top of that each patient joins the
 * group for the treatment they booked (and Clare's Patients if they see
 * Clare). Groups are added, never removed. Pure, unit-tested in
 * tests/mailerlite.test.ts.
 */

export const MARKETING_OPT_IN_LABEL = "Send me Northbank's newsletter, exclusive offers and a birthday treat.";
export const MARKETING_OPT_IN_HINT = "Optional. You can unsubscribe at any time.";

export const GROUP = {
  physio: "Physio Patients",
  running: "Running Assessment Patients",
  womensHealth: "Women's Health Patients",
  scoliosis: "Scoliosis Patients",
  massage: "Massage Clients",
  osteopathy: "Osteopathy Patients",
  acupuncture: "Acupuncture Patients",
  clare: "Clare's Patients",
  voucherBuyers: "Gift Voucher Buyers", // bought a gift voucher and ticked the box (lib/voucher-webhook.ts)
} as const;

/** Group names compared without case, spacing or curly apostrophes. */
export const groupKey = (name: string) => name.toLowerCase().replace(/[‘’`]/g, "'").replace(/\s+/g, " ").trim();

/**
 * Which MailerLite groups a booking adds the patient to, from the Cliniko
 * appointment type's category and name and the practitioner's name. The
 * Women's Health and Scoliosis categories also say "Physiotherapy", so
 * they're checked first.
 */
export function mailerliteGroupsFor(a: { category?: string | null; typeName?: string | null; practitionerName?: string | null }): string[] {
  const cat = (a.category ?? "").replace(/^\d+\.\s*/, "").toLowerCase();
  const type = (a.typeName ?? "").toLowerCase();
  const out: string[] = [];
  if (/women'?s health|ante-?natal|post-?natal|breastfeeding/.test(cat)) out.push(GROUP.womensHealth);
  else if (/scoliosis/.test(cat)) out.push(GROUP.scoliosis);
  else if (/massage/.test(cat)) out.push(GROUP.massage);
  else if (/osteopath/.test(cat)) out.push(GROUP.osteopathy);
  else if (/acupuncture/.test(cat)) out.push(GROUP.acupuncture);
  else if (/physio|shockwave|laser/.test(cat)) out.push(GROUP.physio);
  if (/running assessment/.test(type)) {
    out.push(GROUP.running);
    if (!out.includes(GROUP.physio)) out.push(GROUP.physio);
  }
  if (/\bclare\b/i.test(a.practitionerName ?? "")) out.push(GROUP.clare);
  return out;
}

/** A date of birth fit for MailerLite's date field (YYYY-MM-DD), or undefined. */
export function birthdayField(dateOfBirth: string | null | undefined): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth ?? "");
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1900) return undefined;
  return dateOfBirth!;
}
