/**
 * One shared layout for every email the Hub sends (codes, refunds, fees,
 * reschedules, clinic alerts). Pure, no I/O, unit-tested.
 *
 * Rules (docs/design.md, Emails):
 * - One column, about 600px wide. All text is live HTML, never images.
 * - System fonts: web fonts are unreliable in email clients.
 * - The subject carries the facts; the first line repeats them.
 * - A navy "Manage booking" button at least 44px tall, with a text-link fallback.
 * - The policy sentence comes last.
 * - A login code is shown as large, selectable text. Code emails follow
 *   codeEmail() so phones can offer the code automatically (below).
 * - No red except the logo. A plain-text part is always sent too.
 *
 * Email clients ignore <style> and most modern CSS, so this is deliberately
 * old-school: tables and inline styles only.
 */

import { whenShort } from "./format.ts";
import { fillTemplate, type EmailOverrides } from "./email-templates.ts";
import { CLINIC_PHONE } from "./policy.ts";

const NAVY = "#0b6b63"; // demo: Northbank teal
const LOGO_RED = "#D72A2E"; // the logo only
const INK = "#1B2140";
const TEXT = "#4D4D4D";
const DIVIDER = "#D9DCE8";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type EmailExtras = {
  /** A one-time code, shown large and selectable. */
  code?: string;
  /** The single call to action, e.g. { label: "Manage booking", url }. */
  action?: { label: string; url: string };
  /** The cancellation policy sentence, shown last. */
  policy?: string;
};

/**
 * "Booked: Physiotherapy, Tue 13 Oct, 10:30am – Northbank". The facts go in
 * the subject; no health detail beyond the treatment name.
 */
export function emailSubject(prefix: string, appointmentTypeName?: string | null, startsAtISO?: string | null) {
  const facts = [appointmentTypeName?.replace(/^\d+\.\s*/, "").trim(), startsAtISO ? whenShort(startsAtISO) : null].filter(Boolean).join(", ");
  return facts ? `${prefix}: ${facts} – Northbank` : `${prefix} – Northbank`;
}

/**
 * The one-time code email (returning patient, Manage a booking and the staff
 * dashboard sign-in), written
 * so phones and mail apps can pick the code out and offer it:
 * - Apple Mail + Safari ("Security code AutoFill", iOS 17 / macOS 14) and
 *   Gmail / Outlook "Copy code" look for a short message with the words
 *   "verification code" next to the digits.
 * - The code leads the subject, so it's readable in the notification and
 *   on the lock screen without opening the email.
 * - The first line says "Your Northbank verification code is 123456."
 * - No other digits anywhere (no "10 minutes", no phone number or street
 *   number in the footer): a second number can be picked up instead.
 */
export function codeEmail(code: string, page: "booking" | "manage" | "dashboard", overrides?: EmailOverrides | null) {
  const where = { booking: "the booking page", manage: "the Manage a booking page", dashboard: "the Northbank dashboard sign-in page" }[page];
  const mail = fillTemplate("code", { code, where }, overrides);
  return { subject: mail.subject, text: mail.text, code };
}

/** Manage a booking, when nobody on the email has an upcoming appointment: sent instead of a code. */
export function noUpcomingEmail(overrides?: EmailOverrides | null) {
  const mail = fillTemplate("manage_none", { clinic_phone: CLINIC_PHONE }, overrides);
  return { subject: mail.subject, text: mail.text, button: mail.button };
}

export function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Runs on already-escaped text, so a URL can't carry markup or break out of href.
function linkify(escaped: string) {
  return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" style="color:${NAVY};text-decoration:underline">${url}</a>`);
}

// Only real web links become buttons; anything else (e.g. javascript:) is dropped.
const isSafeUrl = (u: string) => /^https:\/\//.test(u) || /^http:\/\/localhost[:/]/.test(u);

/** The plain-text part: the same body and extras, in the same order as the HTML. */
export function emailText(text: string, extras: EmailExtras = {}) {
  const parts = text.trim().split(/\n{2,}/);
  if (extras.code && !text.includes(extras.code)) parts.splice(1, 0, `Your code: ${extras.code}`);
  if (extras.action && isSafeUrl(extras.action.url)) parts.push(`${extras.action.label}: ${extras.action.url}`);
  if (extras.policy) parts.push(extras.policy);
  return parts.join("\n\n");
}

export function brandedEmailHtml(subject: string, text: string, extras: EmailExtras = {}) {
  const paras = text.trim().split(/\n{2,}/);
  const p = (s: string) => `<p style="margin:0 0 16px">${linkify(escapeHtml(s)).replace(/\n/g, "<br>")}</p>`;
  const first = paras.length ? p(paras[0]) : "";
  const rest = paras.slice(1).map(p).join("");

  const code = extras.code
    ? `<p style="margin:8px 0 24px;font-size:32px;line-height:40px;font-weight:700;letter-spacing:4px;color:${INK};font-variant-numeric:tabular-nums">${escapeHtml(extras.code)}</p>`
    : "";

  const action =
    extras.action && isSafeUrl(extras.action.url)
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px"><tr>
<td bgcolor="${NAVY}" style="border-radius:8px;background:${NAVY}">
<a href="${escapeHtml(extras.action.url)}" style="display:inline-block;padding:14px 24px;min-height:20px;font-family:${FONT};font-size:17px;line-height:20px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px">${escapeHtml(extras.action.label)}</a>
</td></tr></table>
<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:${TEXT}">Or copy this link: <a href="${escapeHtml(extras.action.url)}" style="color:${NAVY};text-decoration:underline;word-break:break-all">${escapeHtml(extras.action.url)}</a></p>`
    : "";

  // Code emails: no digits in the footer, so the code is the only number (see codeEmail).
  const footer = extras.code
    ? `Northbank Physio, Dublin 2, Dublin.`
    : `Northbank, 12 Quay Street, Dublin 2 · <a href="tel:+353 1 555 0100" style="color:${NAVY}">01 555 0100</a><br>
Reply to this email or call us with any questions. Card payments are handled securely by Stripe.`;

  const policy = extras.policy
    ? `<p style="margin:8px 0 0;padding-top:16px;border-top:1px solid ${DIVIDER};font-size:15px;line-height:22px;color:${TEXT}">${escapeHtml(extras.policy)}</p>`
    : "";

  return `<!doctype html>
<html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;color:${INK};font-family:${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
<tr><td style="padding:0 0 24px;border-bottom:1px solid ${DIVIDER}">
<div style="font-size:26px;line-height:28px;font-weight:800;letter-spacing:0.5px"><span style="color:${NAVY}">BODY</span><span style="color:${LOGO_RED}">MED</span></div>
<div style="margin-top:4px;font-size:11px;line-height:14px;font-weight:700;letter-spacing:2px;color:${TEXT}">PHYSIO &amp; HEALTHCARE CLINIC</div>
</td></tr>
<tr><td style="padding:24px 0 8px;font-size:17px;line-height:26px;color:${INK}">${first}${code}${rest}${action}${policy}</td></tr>
<tr><td style="padding:16px 0 0;border-top:1px solid ${DIVIDER};font-size:14px;line-height:21px;color:${TEXT}">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
